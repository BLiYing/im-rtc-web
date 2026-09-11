import { ErrorCode, RtcError } from '../errors.js';
import { logger, redactCandidate, redactSdp } from '../logger.js';
import type { PcRole } from '../signaling/enums.js';
import type {
  LocalTrackInfo,
  MediaAdapter,
  MediaAdapterEvents,
  MediaSource,
} from './mediaAdapter.js';
import type { VideoProfile } from './videoProfile.js';
import { defaultVideoProfile, simulcastEncodings, videoConstraints } from './videoProfile.js';

/**
 * 浏览器 WebRTC 的媒体适配器。
 *
 * **两条 PeerConnection，各有固定 offerer**（协议 §3.3）：pub 由本端 offer、
 * sub 由服务端 offer。固定 offerer 就没有 glare，所以这里**没有一行**
 * perfect negotiation / rollback。
 *
 * **不配 iceServers**：SFU 有公网 IP，客户端直连它，不部署 TURN（拍板 §11-2）。
 */
export class WebRTCAdapter implements MediaAdapter {
  private readonly source: MediaSource;
  private pub: RTCPeerConnection | null = null;
  private sub: RTCPeerConnection | null = null;
  private events: MediaAdapterEvents | null = null;

  /** cid → 本端轨道。cid 就是轨道的 id（见 LocalTrackInfo）。 */
  private readonly locals = new Map<string, MediaStreamTrack>();
  /** 候选缓存：PC 的远端描述还没设时收到的候选先存着（乱序是常态）。 */
  private readonly pendingCandidates: Record<PcRole, RTCIceCandidateInit[]> = { pub: [], sub: [] };

  /** 采集画质档位。见 videoProfile.ts：**策略归宿主**，不是服务端下发的。 */
  private readonly video: VideoProfile;
  /** 已经在预览的摄像头轨道。发布时复用它，不重开设备。 */
  private preview: { track: MediaStreamTrack; stream: MediaStream } | null = null;
  /** 预览那条轨道是否已经挂到 pub 上。`addTrack` 同一条轨道两次会抛异常。 */
  private cameraPublished = false;
  /** 麦克风权限已经探过一次。见 `probeMicrophone`：探测不是免费的。 */
  private micProbed = false;
  /** 摄像头权限已经探过一次。见 `probeCamera`。 */
  private cameraProbed = false;
  /**
   * 正在起的那次预览。**并发的 startLocalPreview / acquireCamera / probeCamera 共用这一次 getUserMedia**。
   *
   * 来电页的预览还没起完、用户就点了接听：接听路径要探权限、要起预览、进房后还要发布，
   * 三处各自去 `getUserMedia` 就是把摄像头开两三次——多出来的那条流没人收，指示灯灭不掉。
   */
  private previewOpening: Promise<LocalTrackInfo> | null = null;
  /** close() 一次加一。起到一半被 close 掉的预览靠它认出自己已经作废。 */
  private closeGeneration = 0;

  /** source 缺省时用 navigator.mediaDevices；端到端测试可以传合成源。 */
  constructor(source?: MediaSource, videoProfile?: VideoProfile) {
    this.source = source ?? {
      getStream: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    };
    this.video = videoProfile ?? defaultVideoProfile;
  }

  open(events: MediaAdapterEvents): void {
    this.events = events;
    this.pub = this.createPeer('pub');
    this.sub = this.createPeer('sub');

    this.sub.ontrack = (event): void => {
      const track = event.track;
      // 下行轨道的 id 就是协议里的 track_id（服务端把 msid 设成了它）。
      logger.info('收到下行轨道', { track_id: track.id, kind: track.kind });
      events.onRemoteTrack(track.id, track);
    };
  }

  /** 下一个上行 offer 要不要带 ICE restart。见 restartPubICE()。 */
  private pubICERestartPending = false;

  private createPeer(role: PcRole): RTCPeerConnection {
    const peer = new RTCPeerConnection({ iceServers: [] });
    peer.onicecandidate = (event): void => {
      if (event.candidate === null) return; // 收集结束；服务端不需要这条也能工作
      const init = event.candidate.toJSON();
      logger.debug('本端候选', { pc: role, candidate: redactCandidate(init.candidate ?? '') });
      this.events?.onLocalCandidate(role, init);
    };
    peer.onconnectionstatechange = (): void => {
      logger.info('PC 状态变化', { pc: role, state: peer.connectionState });
      this.events?.onConnectionStateChange(role, peer.connectionState);
    };
    return peer;
  }

  async acquireMicrophone(): Promise<LocalTrackInfo> {
    return this.acquire({ audio: true }, 'audio', 'microphone');
  }

  async probeMicrophone(): Promise<void> {
    /*
      **探过一次就不再探。** 一次探测要向 `MediaSource` 要一份完整的流，而源在那条流
      背后建了什么、又由谁来收，适配器是不知道的——Demo 的合成源每次 `getStream` 都新建
      一个 `AudioContext` + 振荡器，只在 `source.stop()` 里收。停掉轨道收不掉它们，
      于是**每拨一次号泄漏一个 AudioContext**；浏览器对同一页面的 AudioContext 有个位数的
      上限，几通电话之后 `new AudioContext()` 直接抛，麦克风就再也发布不出去了。

      权限一旦给过就不会自己收回（真收回了，随后的 `acquireMicrophone` 会照常抛 2001，
      界面还是能正确降级），所以缓存这一个布尔值是安全的。
    */
    if (this.micProbed) return;
    const stream = await this.getStreamOrThrow({ audio: true });
    // 探完就放：这条轨道只是为了让权限框弹出来，留着会让麦克风指示灯一直亮。
    for (const track of stream.getTracks()) track.stop();
    this.micProbed = true;
  }

  async probeCamera(): Promise<void> {
    // 与 probeMicrophone 同一个缓存理由；已经在预览说明权限早就拿到了。
    if (this.cameraProbed || this.preview !== null) return;
    // 预览正在起：它的结果就是探测结果（失败时抛的是同一个错误），再开一次会抢同一个摄像头。
    if (this.previewOpening !== null) {
      await this.previewOpening;
      return;
    }
    const stream = await this.getStreamOrThrow({ video: videoConstraints(this.video) });
    // 探完就放：只为让权限框弹出来，留着摄像头指示灯会一直亮——而用户可能根本没开摄像头。
    for (const track of stream.getTracks()) track.stop();
    this.cameraProbed = true;
  }

  /**
   * startLocalPreview 只起采集，不挂到 pub 上。
   *
   * **拨出中就该看得见自己**（草图 §03-E），可那时还没有房间、推不了流。
   * 所以采集与发布拆成两步，`acquireCamera` 复用这条轨道——
   * 不复用的话第二次 `getUserMedia` 会去抢同一个摄像头。
   */
  async startLocalPreview(): Promise<LocalTrackInfo> {
    if (this.preview !== null) return previewInfo(this.preview.track);
    // 单飞：已经有一次在起就等它，见 `previewOpening`。
    if (this.previewOpening === null) this.previewOpening = this.openPreview(this.closeGeneration);
    return this.previewOpening;
  }

  private async openPreview(generation: number): Promise<LocalTrackInfo> {
    try {
      const stream = await this.getStreamOrThrow({ video: videoConstraints(this.video) });
      if (generation !== this.closeGeneration) {
        // 起到一半通话结束了（close 已经跑过）：这条流再没人会收，当场放掉，指示灯才会灭。
        for (const track of stream.getTracks()) track.stop();
        throw new RtcError(ErrorCode.invalidState, { cause: new Error('预览起到一半媒体层已关闭') });
      }
      const track = stream.getVideoTracks()[0];
      if (track === undefined) {
        throw new RtcError(ErrorCode.deviceNotFound, {
          cause: new Error('getUserMedia 没返回 video 轨道'),
        });
      }
      this.preview = { track, stream };
      this.locals.set(track.id, track);
      return previewInfo(track);
    } finally {
      // 只收自己这一代的：close 之后新起的那次预览不能被上一代的收尾抹掉。
      if (generation === this.closeGeneration) this.previewOpening = null;
    }
  }

  async acquireCamera(simulcast = true): Promise<LocalTrackInfo> {
    // **复用预览那条轨道**：拨出时已经开过摄像头了，再开一次会抢设备。
    const info = await this.startLocalPreview();
    if (this.preview === null || this.cameraPublished) return info;
    this.cameraPublished = true;
    this.addVideoTrack(this.preview.track, this.preview.stream, simulcast);
    return info;
  }

  /**
   * addVideoTrack 把一条上行视频挂到 pub 上。
   *
   * # 为什么不能用 addTrack
   *
   * `addTrack` 只会产生**一个 encoding**，浏览器里发 simulcast 必须在建
   * transceiver 时就把 `sendEncodings` 给出来——协商之后再 `setParameters`
   * 加层是加不上的（规范不允许改 encoding 的条数）。
   *
   * 这正是之前那个洞：`publishCamera(simulcast = true)` 的这个参数一路传进了
   * `room.publish` 帧、**告诉服务端「我是 simulcast」**，可媒体面走的是裸
   * `addTrack`，实际只发一层。服务端于是只看到空 RID 的单层（`ridToLayer("")`
   * 当成 h），层选择无从谈起：订阅者报 `l` 也只能收到全速率的 h
   * （`selectLayer` 的兜底），弱下行的那一方被自己的全速率流压死。
   *
   * `streams: [stream]` 不能省：msid 的第二段就是 cid，服务端靠它认领 m-line
   * （协议 §3.2）。省掉它服务端永远认不回这条轨道。
   */
  private addVideoTrack(track: MediaStreamTrack, stream: MediaStream, simulcast: boolean): void {
    const pub = this.requirePub();
    if (!simulcast) {
      this.applyVideoBitrate(pub.addTrack(track, stream));
      return;
    }
    const transceiver = pub.addTransceiver(track, {
      direction: 'sendonly',
      streams: [stream],
      sendEncodings: simulcastEncodings(this.video),
    });
    logger.info('上行视频已按 simulcast 发布', {
      cid: track.id,
      layers: simulcastEncodings(this.video).map((e) => e.rid).join(','),
    });
    this.applyVideoBitrate(transceiver.sender);
  }

  /**
   * acquire 拿一条本端轨道并挂到 pub PC 上。
   *
   * `getUserMedia` **只在 localhost / HTTPS 可用**；权限被拒要有明确的界面态与重试，
   * **不弹 alert**（CONVENTIONS §8）——所以这里只抛结构化错误，界面怎么表现由 uikit 决定。
   */
  private async acquire(
    constraints: MediaStreamConstraints,
    kind: 'audio' | 'video',
    source: 'microphone' | 'camera',
  ): Promise<LocalTrackInfo> {
    const pub = this.requirePub();
    const stream = await this.getStreamOrThrow(constraints);

    const track = kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
    if (track === undefined) {
      throw new RtcError(ErrorCode.deviceNotFound, {
        cause: new Error(`getUserMedia 没返回 ${kind} 轨道`),
      });
    }
    if (kind === 'video') {
      this.addVideoTrack(track, stream, true);
    } else {
      pub.addTrack(track, stream);
    }
    this.locals.set(track.id, track);
    return { cid: track.id, kind, source };
  }

  /** getStreamOrThrow 取流，并把浏览器的异常收敛成结构化错误。 */
  private async getStreamOrThrow(constraints: MediaStreamConstraints): Promise<MediaStream> {
    try {
      return await this.source.getStream(constraints);
    } catch (cause) {
      const code = isPermissionError(cause)
        ? ErrorCode.devicePermissionDenied
        : ErrorCode.deviceNotFound;
      throw new RtcError(code, { cause });
    }
  }

  /**
   * applyVideoBitrate 给上行视频压一个码率上限。
   *
   * **不设的话浏览器会自己往上飙**：Chrome 对 720p 的默认上限远高于我们给
   * simulcast h 层定的目标值，服务端的带宽预算（`bwe.go` 的 `bitrateHigh`）
   * 就成了一个对不上的数字，降层判断跟着不准。
   *
   * 失败只记日志：码率是画质偏好，`setParameters` 被拒不该让通话打不出去。
   */
  private applyVideoBitrate(sender: RTCRtpSender): void {
    const params = sender.getParameters();
    // encodings 可能还是空的（协商之前）；补一个默认项，浏览器会认。
    if (params.encodings.length === 0) params.encodings = [{}];
    /*
     **simulcast 的三层各有各的码率，不能抹平成同一个值。**
     全设成 h 的目标码率等于让 l / m 两层也按 1.5Mbps 发，
     上行瞬间涨到三倍，而降层根本省不下带宽——降了个寂寞。
     按 rid 对号入座；没有 rid（单层发布）才用整档的上限。
    */
    const byRid = new Map(simulcastEncodings(this.video).map((e) => [e.rid, e.maxBitrate]));
    for (const encoding of params.encodings) {
      encoding.maxBitrate = byRid.get(encoding.rid) ?? this.video.maxBitrateBps;
    }
    void sender.setParameters(params).catch((err: unknown) => {
      logger.info('设置上行码率失败，用浏览器默认值', { err: String(err) });
    });
  }

  async createPubOffer(): Promise<string> {
    const pub = this.requirePub();
    const iceRestart = this.pubICERestartPending;
    this.pubICERestartPending = false;
    if (iceRestart) logger.info('上行重启 ICE', {});
    const offer = await pub.createOffer({ iceRestart });
    await pub.setLocalDescription(offer);
    logger.debug('生成上行 offer', { sdp: redactSdp(offer.sdp) });
    return offer.sdp ?? '';
  }

  /**
   * restartPubICE 让**下一个**上行 offer 带上 ICE restart（换一对新 ufrag/pwd 重新打洞）。
   *
   * `pub` 那条 PC 的 offerer 恒为本端（协议 §3.3），它 `failed` 了只能自己救；
   * `sub` 那条由服务端救——**各自重启自己 offer 的那条**，不需要新的协议帧，也不会 glare。
   * 做成「置一个位、下一个 offer 生效」而不是「立刻发帧」：发帧是 engine 的事，媒体层不认识信令。
   */
  restartPubICE(): void {
    this.pubICERestartPending = true;
  }

  async applyPubAnswer(sdp: string): Promise<void> {
    const pub = this.requirePub();
    await pub.setRemoteDescription({ type: 'answer', sdp });
    await this.drainCandidates('pub');
  }

  async answerSubOffer(sdp: string): Promise<string> {
    const sub = this.requireSub();
    await sub.setRemoteDescription({ type: 'offer', sdp });
    await this.drainCandidates('sub');
    const answer = await sub.createAnswer();
    await sub.setLocalDescription(answer);
    return answer.sdp ?? '';
  }

  /**
   * addRemoteCandidate 加一个远端候选。
   *
   * 远端描述还没设时**缓存起来而不是报错**——trickle ICE 与 offer/answer 天然会赛跑，
   * 协议要求容忍（§3.3）。
   */
  async addRemoteCandidate(pc: PcRole, candidate: RTCIceCandidateInit): Promise<void> {
    if (candidate.candidate === undefined || candidate.candidate === '') return;
    const peer = pc === 'pub' ? this.pub : this.sub;
    if (peer === null) return;

    if (peer.remoteDescription === null) {
      this.pendingCandidates[pc].push(candidate);
      return;
    }
    try {
      await peer.addIceCandidate(candidate);
    } catch (cause) {
      logger.debug('候选加不进去，忽略', {
        pc,
        candidate: redactCandidate(candidate.candidate),
        cause: String(cause),
      });
    }
  }

  private async drainCandidates(pc: PcRole): Promise<void> {
    const peer = pc === 'pub' ? this.pub : this.sub;
    if (peer === null) return;
    const queued = this.pendingCandidates[pc].splice(0);
    for (const candidate of queued) {
      try {
        await peer.addIceCandidate(candidate);
      } catch (cause) {
        logger.debug('缓存的候选加不进去，忽略', { pc, cause: String(cause) });
      }
    }
  }

  setMuted(cid: string, muted: boolean): void {
    const track = this.locals.get(cid);
    if (track === undefined) return;
    // enabled=false 会让浏览器发静音帧/黑帧而不是断流——协商与 Track 都保留，
    // 这正是 mute 与 unpublish 的区别。
    track.enabled = !muted;
  }

  localTrack(cid: string): MediaStreamTrack | undefined {
    return this.locals.get(cid);
  }

  close(): void {
    // 轨道用完必须 stop()，否则摄像头指示灯不灭（CONVENTIONS §8）。
    for (const track of this.locals.values()) track.stop();
    this.locals.clear();
    this.preview = null;
    this.cameraPublished = false;
    // 还在起的预览作废：它回来时认出代数不对，自己把流放掉（openPreview）。
    this.previewOpening = null;
    this.closeGeneration += 1;
    this.pendingCandidates.pub = [];
    this.pendingCandidates.sub = [];
    this.pub?.close();
    this.sub?.close();
    this.pub = null;
    this.sub = null;
    this.events = null;
  }

  private requirePub(): RTCPeerConnection {
    if (this.pub === null) throw new RtcError(ErrorCode.invalidState, { cause: new Error('媒体层未打开') });
    return this.pub;
  }

  private requireSub(): RTCPeerConnection {
    if (this.sub === null) throw new RtcError(ErrorCode.invalidState, { cause: new Error('媒体层未打开') });
    return this.sub;
  }
}

function isPermissionError(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError');
}

/** previewInfo 把预览轨道翻成 LocalTrackInfo。cid 就是轨道的 id（协议 §3.2）。 */
function previewInfo(track: MediaStreamTrack): LocalTrackInfo {
  return { cid: track.id, kind: 'video', source: 'camera' };
}
