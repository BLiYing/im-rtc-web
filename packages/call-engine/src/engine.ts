import { ErrorCode, RtcError, errorName, isRtcError } from './errors.js';
import { EventBus } from './eventBus.js';
import type { EngineEventHandler, EngineEventName } from './events.js';
import { MACHINE_EVENT_NAMES } from './events.js';
import { logger } from './logger.js';
import type { MediaAdapter } from './media/mediaAdapter.js';
import type { ViewElement } from './media/viewRegistry.js';
import { ViewRegistry } from './media/viewRegistry.js';
import { WebRTCAdapter } from './media/webrtcAdapter.js';
import { camelizeArgs } from './signaling/caseMapping.js';
import type { HelloOk } from './signaling/connection.js';
import { Connection } from './signaling/connection.js';
import type { Layer, MediaType, PcRole } from './signaling/enums.js';
import { FrameSender } from './signaling/frameSender.js';
import type { WebSocketFactory } from './signaling/webSocket.js';
import type { EngineContext } from './state/engineMachine.js';
import { initialEngineContext, reduceEngine } from './state/engineMachine.js';
import type { EmittedEvent, MachineInput, OutgoingFrame } from './state/types.js';

/**
 * CallEngine 是门面：把信令连接、状态机、媒体适配器接在一起。
 *
 * # 它自己不做决策
 *
 * 「现在能不能 accept」「该不该抛 onCallEnd」全在状态机里（那是纯逻辑，跑一致性向量）；
 * 「SDP 长什么样」全在媒体适配器里。门面只做三件事：**路由输入、填 SDP、派发事件**。
 *
 * # 为什么门面要填 SDP
 *
 * 状态机是纯的，产不出 SDP。所以它产出的协商帧是**意图**——`sdp` 字段留空，
 * 由门面从媒体适配器取真值填进去再发。这条边界让状态机能在 Node 里被完整测试。
 */

/** EngineOptions 是构造参数。 */
export interface EngineOptions {
  /** 信令地址，如 `wss://rtc.example.com/v1/ws`。 */
  url: string;
  deviceId: string;
  /** 媒体适配器。默认用浏览器 WebRTC；测试可注入假实现。 */
  media?: MediaAdapter;
  /** WebSocket 工厂。默认用浏览器原生；测试可注入假实现。 */
  webSocketFactory?: WebSocketFactory;
}

/** CallEngine 是宿主唯一需要接触的类型。 */
export class CallEngine {
  private readonly bus = new EventBus();
  private readonly media: MediaAdapter;
  private readonly options: EngineOptions;

  private readonly sender: FrameSender;
  private connection: Connection | null = null;
  private ctx: EngineContext = initialEngineContext;
  /** 已经抛过 firstVideoFrame 的轨道，避免重复抛。 */
  private readonly seenVideo = new Set<string>();
  /** uid ↔ 视频元素的挂载登记（uikit 只能经它挂画面，CONVENTIONS §1）。 */
  private readonly views = new ViewRegistry();

  constructor(options: EngineOptions) {
    this.options = options;
    this.media = options.media ?? new WebRTCAdapter();
    this.sender = new FrameSender(this.media);
  }

  /** on 订阅事件，返回退订函数。事件表见 events.ts（= 设计文档 §7.5）。 */
  on<K extends EngineEventName>(name: K, handler: EngineEventHandler<K>): () => void {
    return this.bus.on(name, handler);
  }

  /** state 返回当前的通话与房间状态，供 UI 渲染。 */
  get state(): EngineContext {
    return this.ctx;
  }

  /** login 建立信令连接并完成握手。 */
  async login(token: string): Promise<HelloOk> {
    const connection = new Connection({
      url: this.options.url,
      token,
      deviceId: this.options.deviceId,
      ...(this.options.webSocketFactory === undefined
        ? {}
        : { webSocketFactory: this.options.webSocketFactory }),
      events: {
        onEvent: (type, data): void => {
          void this.handleIncoming(type, data);
        },
        onDisconnected: (info): void => {
          void this.dispatch({ kind: 'internal', name: 'disconnected' });
          this.bus.emit('disconnected', { code: info.code, willReconnect: info.willReconnect });
        },
        onKickedOut: (): void => {
          void this.dispatch({ kind: 'internal', name: 'ws_closed_4403' });
        },
        onError: (error): void => this.emitError(error),
      },
    });
    this.connection = connection;
    this.media.open({
      onLocalCandidate: (pc, candidate): void => this.sendCandidate(pc, candidate),
      onRemoteTrack: (trackId, track): void => this.onRemoteTrack(trackId, track),
      onConnectionStateChange: (pc, state): void => this.onPcState(pc, state),
    });

    const hello = await connection.connect();
    await this.dispatch({
      kind: 'recv',
      type: 'sys.hello.ok',
      data: { session_id: hello.sessionId, resumed: hello.resumed },
    });
    return hello;
  }

  /** logout 关掉连接与媒体。 */
  logout(): void {
    this.connection?.close();
    this.connection = null;
    this.media.close();
    this.views.clear();
    this.seenVideo.clear();
    this.ctx = initialEngineContext;
  }

  /** call 发起通话。 */
  async call(calleeIds: string[], mediaType: MediaType, isGroup = false): Promise<void> {
    await this.dispatch({
      kind: 'act',
      op: 'call',
      args: { callee_ids: calleeIds, media_type: mediaType, is_group: isGroup },
    });
  }

  /** accept 接听。 */
  async accept(): Promise<void> {
    await this.dispatch({ kind: 'act', op: 'accept' });
  }

  /** reject 拒接。 */
  async reject(): Promise<void> {
    await this.dispatch({ kind: 'act', op: 'reject' });
  }

  /** cancel 取消呼出（**仅接通前**；接通后用 hangup）。 */
  async cancel(): Promise<void> {
    await this.dispatch({ kind: 'act', op: 'cancel' });
  }

  /** hangup 挂断（接通后，主被叫都用它）。 */
  async hangup(): Promise<void> {
    await this.dispatch({ kind: 'act', op: 'hangup' });
  }

  /** joinRoom 直接进一个会议房（不走振铃）。 */
  async joinRoom(roomId: string, roomToken: string, autoSubscribe = true): Promise<void> {
    await this.dispatch({
      kind: 'act',
      op: 'join',
      args: { room_id: roomId, room_token: roomToken, auto_subscribe: autoSubscribe },
    });
  }

  /** leaveRoom 离房。 */
  async leaveRoom(): Promise<void> {
    await this.dispatch({ kind: 'act', op: 'leave' });
  }

  /**
   * publishMicrophone 发布麦克风。
   *
   * 顺序是**先拿轨道再拿 cid**：浏览器不允许自定义 track.id，而服务端靠
   * msid 里的 cid 认领 m-line（协议 §3.2）。
   */
  async publishMicrophone(): Promise<string> {
    const info = await this.media.acquireMicrophone();
    await this.dispatch({
      kind: 'act',
      op: 'publish',
      args: { cid: info.cid, kind: info.kind, source: info.source, simulcast: false },
    });
    return info.cid;
  }

  /** publishCamera 发布摄像头。 */
  async publishCamera(simulcast = true): Promise<string> {
    const info = await this.media.acquireCamera();
    await this.dispatch({
      kind: 'act',
      op: 'publish',
      args: { cid: info.cid, kind: info.kind, source: info.source, simulcast },
    });
    return info.cid;
  }

  /** setMuted 开关本端某条轨道。**不是 unpublish**，协商保留。 */
  async setMuted(cid: string, muted: boolean): Promise<void> {
    this.media.setMuted(cid, muted);
    const trackId = this.ctx.room.publishTrackIds[cid];
    if (trackId === undefined) return;
    await this.dispatch({ kind: 'act', op: 'mute', args: { track_id: trackId, muted } });
  }

  /** localTrack 取本端轨道做预览。 */
  localTrack(cid: string): MediaStreamTrack | undefined {
    return this.media.localTrack(cid);
  }

  /**
   * attachView 把某个 uid 的远端画面挂到一个 `<video>` 上；传 `null` 卸载。
   *
   * **这是 UI 拿到画面的唯一途径**（CONVENTIONS §1）：uikit 不许自己碰
   * `RTCPeerConnection`，也不该自己拼 `MediaStream`。
   */
  attachView(uid: string, el: ViewElement | null): void {
    this.views.attach(uid, el);
  }

  /** attachLocalView 把本端某条轨道挂到元素上做预览；传 `null` 卸载。 */
  attachLocalView(cid: string, el: ViewElement | null): void {
    if (el === null) return void this.views.attach(localViewKey(cid), null);
    const track = this.media.localTrack(cid);
    if (track !== undefined) this.views.addTrack(track.id, track, localViewKey(cid));
    this.views.attach(localViewKey(cid), el);
  }

  /**
   * setRemoteLayer 报某人画面的**层上界**（协议 §3.5：上界不是命令）。
   *
   * 九宫格缩略图报 `l`、双击放大报 `h`。**不触发重协商**，也不保证立刻切——
   * 服务端要等目标层的关键帧，还会再按带宽估计压一次。
   */
  async setRemoteLayer(uid: string, layer: Layer): Promise<void> {
    for (const [trackId, info] of Object.entries(this.ctx.room.remoteTracks)) {
      if (info.uid !== uid || info.kind !== 'video') continue;
      await this.dispatch({
        kind: 'act',
        op: 'update_layer',
        args: { track_id: trackId, max_layer: layer },
      });
    }
  }

  // ── 内部 ──────────────────────────────────────────────

  /**
   * handleIncoming 是**所有下行帧的唯一入口**——事件与应答都走它。
   *
   * 这里曾经漏了应答那一半：`.ok` 走的是 `request()` 的 Promise，没喂回状态机，
   * 于是 `room.join` 发出去了、`room.join.ok` 回来了，房间状态却永远停在 `joining`，
   * 随后的 publish 全被 R1「只有 joined 才允许发布」本地拒掉。
   */
  private async handleIncoming(type: string, data: Record<string, unknown>): Promise<void> {
    if (type === 'room.offer' && data['pc'] === 'sub') {
      this.sender.noteSubOffer(typeof data['sdp'] === 'string' ? data['sdp'] : '');
    }
    if (type === 'room.answer' && data['pc'] === 'pub') {
      // 先把 SDP 应用到媒体层，再让状态机把发布状态推进到 published。
      await this.media.applyPubAnswer(typeof data['sdp'] === 'string' ? data['sdp'] : '');
    }
    await this.dispatch({ kind: 'recv', type, data });
  }

  /** dispatch 把一个输入喂进状态机，然后发帧、抛事件。 */
  private async dispatch(input: MachineInput): Promise<void> {
    const result = reduceEngine(this.ctx, input);
    this.ctx = result.state;

    for (const frame of result.send) {
      await this.sendFrame(frame);
    }
    this.claimViews();
    for (const event of result.emit) {
      this.emitMachineEvent(event);
    }
  }

  /** sendFrame 发一帧，并把应答喂回状态机。 */
  private async sendFrame(frame: OutgoingFrame): Promise<void> {
    const connection = this.connection;
    if (connection === null) return;
    try {
      const reply = await this.sender.send(connection, frame.type, frame.data);
      // **应答也要喂回状态机**：join.ok / publish.ok 都是状态推进的关键一步。
      if (reply !== null) await this.handleIncoming(reply.type, reply.data);
    } catch (err) {
      // 请求失败不该中断整个事件流：转成 error 事件交给宿主。
      this.emitError(err);
    }
  }

  private sendCandidate(pc: PcRole, candidate: RTCIceCandidateInit): void {
    const connection = this.connection;
    if (connection === null) return;
    void this.sender
      .sendCandidate(connection, pc, candidate)
      .catch((err: unknown) => this.emitError(err));
  }

  private onRemoteTrack(trackId: string, track: MediaStreamTrack): void {
    const uid = this.ctx.room.remoteTracks[trackId]?.uid ?? '';
    // uid 可能还不知道（ontrack 与 track_published 谁先到都可能）——
    // 那就先收着，claimViews 会在状态机补上归属之后认领。
    this.views.addTrack(trackId, track, uid);
    this.bus.emit('remoteTrack', { trackId, track });
    if (track.kind !== 'video' || this.seenVideo.has(trackId)) return;
    this.seenVideo.add(trackId);
    // firstVideoFrame 没有对应的信令帧——它是本地事件，UI 用来撤 loading。
    this.bus.emit('firstVideoFrame', { uid, trackId });
  }

  /** claimViews 把「轨道先到、归属后到」的那些补挂上去，并摘掉已经没了的。 */
  private claimViews(): void {
    for (const [trackId, info] of Object.entries(this.ctx.room.remoteTracks)) {
      this.views.claim(trackId, info.uid);
    }
  }

  private onPcState(pc: PcRole, state: RTCPeerConnectionState): void {
    logger.debug('PC 状态', { pc, state });
    if (pc === 'sub' && state === 'connected') {
      void this.dispatch({ kind: 'internal', name: 'media_ready' });
    }
  }

  /** emitMachineEvent 把状态机的 onXxx 翻成公开事件名，并把参数转成 camelCase。 */
  private emitMachineEvent(event: EmittedEvent): void {
    const name = MACHINE_EVENT_NAMES[event.cb];
    if (name === undefined) {
      logger.warn('状态机抛了一个没登记的回调', { cb: event.cb });
      return;
    }
    // 参数从协议的 snake_case 转成 TS 惯用的 camelCase。
    this.bus.emit(name, camelizeArgs(event.args) as never);
  }

  private emitError(err: unknown): void {
    const error = isRtcError(err) ? err : new RtcError(ErrorCode.internal, { cause: err });
    this.bus.emit('error', {
      code: error.code,
      name: errorName(error.code),
      message: error.message,
    });
  }
}

/**
 * localViewKey 给本端预览一个不会与 uid 撞车的登记键。
 *
 * 本端与远端共用一张登记表（挂载/卸载逻辑完全一样），所以只需要一个前缀区分开。
 * 前缀里带冒号：uid 是宿主给的业务 id，协议没限制字符集，但冒号开头的 uid
 * 本来就不该出现在业务里。
 */
function localViewKey(cid: string): string {
  return `:local:${cid}`;
}
