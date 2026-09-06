import type { PcRole } from '../signaling/enums.js';

/**
 * 媒体适配器：**engine 里唯一碰 WebRTC 与 DOM 的地方**（CONVENTIONS §1）。
 *
 * 抽成接口有两个理由：
 * 1. engine 的其余部分必须能在无 DOM 的环境构造——一致性向量与时序测试都跑在 Node 里；
 * 2. 将来换媒体实现（或做 P2P 隐私模式）只动这一层，状态机与信令一行不用改。
 */

/** LocalTrackInfo 是一条本端轨道。 */
export interface LocalTrackInfo {
  /**
   * cid **等于本地轨道的 id**。
   *
   * 浏览器不允许自定义 `MediaStreamTrack.id`，而 msid 的第二段就是它，
   * 服务端靠它认领 m-line（协议 §3.2）。所以顺序是先拿轨道、再拿 cid、
   * 最后才发 `room.publish`——不能先想一个 cid。
   */
  readonly cid: string;
  readonly kind: 'audio' | 'video';
  readonly source: 'microphone' | 'camera';
}

/** MediaAdapterEvents 是媒体层回给 engine 的出口。 */
export interface MediaAdapterEvents {
  /** 本端收集到一个 ICE 候选，engine 要把它发成 room.ice_candidate。 */
  onLocalCandidate: (pc: PcRole, candidate: RTCIceCandidateInit) => void;
  /** 收到一条下行轨道。trackId 就是协议里的 track_id（msid 第二段）。 */
  onRemoteTrack: (trackId: string, track: MediaStreamTrack) => void;
  /** 某条 PC 的连接状态变了。engine 据此判断「媒体就绪」。 */
  onConnectionStateChange: (pc: PcRole, state: RTCPeerConnectionState) => void;
}

/**
 * MediaSource 是「轨道从哪来」的接缝。
 *
 * 默认实现就是 `navigator.mediaDevices`。抽出来是为了两件事：
 * 1. **浏览器端到端测试**：用 canvas / AudioContext 造合成轨道，不需要真摄像头，
 *    也不需要用户点权限弹窗；
 * 2. 将来做虚拟背景之类的处理链时，只换这一层。
 */
export interface MediaSource {
  getStream(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

/** MediaAdapter 是媒体层的契约。 */
export interface MediaAdapter {
  /** open 建立两条 PeerConnection。**每个参与者最多两条**（CONVENTIONS §8）。 */
  open(events: MediaAdapterEvents): void;

  /** acquireMicrophone 拿麦克风轨道并挂到 pub PC 上，返回它的 cid。 */
  acquireMicrophone(): Promise<LocalTrackInfo>;

  /**
   * probeMicrophone **只探一下麦克风权限**，拿到就立刻放掉，不挂到任何 PC 上。
   *
   * 权限申请的时机规则（交互稿 §01）：主叫在发 `call.invite` **之前**、被叫在发
   * `call.accept` **之前**就得知道麦克风拿不拿得到——拿不到就不该去响别人的铃，
   * 也不该让对方那边显示已接通却听不到人。而 `acquireMicrophone` 要等房间开了
   * （pub PC 存在）才能调，那时早就过了该问的时刻。
   *
   * 探过之后浏览器会记住这次授权，稍后真正的 `acquireMicrophone` 不会再弹框。
   * 被拒抛 `2001 device_permission_denied`，没设备抛 `2002 device_not_found`。
   */
  probeMicrophone(): Promise<void>;

  /**
   * startLocalPreview 只**起采集**，不发布（设计文档 §7.5 的 `startLocalPreview`）。
   *
   * 拨出中还没有房间，推流无从谈起，但界面这时就该让人看见自己（草图 §03-E）。
   * 所以「采集」与「发布」必须是两件事：这个方法起摄像头并返回 cid，
   * 随后的 `acquireCamera` **复用同一条轨道**再挂到 pub 上——否则会把摄像头开两次
   * （浏览器上表现为第二次 `getUserMedia` 抢设备，画面闪一下甚至直接失败）。
   *
   * 幂等：已经在预览就返回同一条。
   */
  startLocalPreview(): Promise<LocalTrackInfo>;

  /** acquireCamera 拿摄像头轨道并挂到 pub PC 上，返回它的 cid。
   *  已经在预览的话**复用那条轨道**，不重开摄像头。 */
  acquireCamera(): Promise<LocalTrackInfo>;

  /** createPubOffer 生成上行 offer。**pub 的 offerer 恒为本端**（协议 §3.3）。 */
  createPubOffer(): Promise<string>;
  /** 让下一个上行 offer 带上 ICE restart。见 webrtcAdapter 里的说明。 */
  restartPubICE(): void;

  /** applyPubAnswer 应用服务端对上行 offer 的应答。 */
  applyPubAnswer(sdp: string): Promise<void>;

  /** answerSubOffer 应答服务端下发的下行 offer。**sub 的 offerer 恒为服务端**。 */
  answerSubOffer(sdp: string): Promise<string>;

  /** addRemoteCandidate 加一个远端候选。乱序到达是常态，实现要容忍。 */
  addRemoteCandidate(pc: PcRole, candidate: RTCIceCandidateInit): Promise<void>;

  /**
   * setMuted 开关本端某条轨道。
   *
   * **这不是 unpublish**：轨道与协商都保留，只是停止发包。
   * 反复开关摄像头走 unpublish 会触发重协商风暴。
   */
  setMuted(cid: string, muted: boolean): void;

  /** localTrack 取一条本端轨道，供 UI 做本地预览。 */
  localTrack(cid: string): MediaStreamTrack | undefined;

  /** close 关掉两条 PC 并停掉所有本端轨道。 */
  close(): void;
}
