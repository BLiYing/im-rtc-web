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
import { defaultVideoProfile, videoConstraints } from './videoProfile.js';

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

  async acquireCamera(): Promise<LocalTrackInfo> {
    return this.acquire({ video: videoConstraints(this.video) }, 'video', 'camera');
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
    let stream: MediaStream;
    try {
      stream = await this.source.getStream(constraints);
    } catch (cause) {
      const code = isPermissionError(cause)
        ? ErrorCode.devicePermissionDenied
        : ErrorCode.deviceNotFound;
      throw new RtcError(code, { cause });
    }

    const track = kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
    if (track === undefined) {
      throw new RtcError(ErrorCode.deviceNotFound, {
        cause: new Error(`getUserMedia 没返回 ${kind} 轨道`),
      });
    }
    const sender = pub.addTrack(track, stream);
    this.locals.set(track.id, track);
    if (kind === 'video') this.applyVideoBitrate(sender);
    return { cid: track.id, kind, source };
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
    for (const encoding of params.encodings) encoding.maxBitrate = this.video.maxBitrateBps;
    void sender.setParameters(params).catch((err: unknown) => {
      logger.info('设置上行码率失败，用浏览器默认值', { err: String(err) });
    });
  }

  async createPubOffer(): Promise<string> {
    const pub = this.requirePub();
    const offer = await pub.createOffer();
    await pub.setLocalDescription(offer);
    logger.debug('生成上行 offer', { sdp: redactSdp(offer.sdp) });
    return offer.sdp ?? '';
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
