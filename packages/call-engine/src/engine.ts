import { EngineBus } from './engineBus.js';
import { ErrorCode } from './errors.js';
import type { EngineEventHandler, EngineEventName } from './events.js';
import { logger } from './logger.js';
import type { MediaAdapter } from './media/mediaAdapter.js';
import { MediaBridge } from './media/mediaBridge.js';
import type { MediaPlaneDeps } from './media/mediaPlane.js';
import { addRemoteCandidate, mediaEvents } from './media/mediaPlane.js';
import type { ViewElement } from './media/viewRegistry.js';
import { WebRTCAdapter } from './media/webrtcAdapter.js';
import type { Connection, HelloOk } from './signaling/connection.js';
import { createConnection } from './signaling/connectionFactory.js';
import type { Layer, MediaType } from './signaling/enums.js';
import { FrameSender } from './signaling/frameSender.js';
import type { WebSocketFactory } from './signaling/webSocket.js';
import type { EngineContext } from './state/engineMachine.js';
import { initialEngineContext, reduceEngine } from './state/engineMachine.js';
import type { MachineInput, OutgoingFrame } from './state/types.js';

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

/**
 * LEAVE_CALLBACKS 是「这一轮媒体到此为止」的信号。
 *
 * 三个都要算：通话正常结束、自己离房、房间被服务端关掉。
 * 少算一个的后果是同一条：下一次进房带着上一轮的 PeerConnection。
 */
const LEAVE_CALLBACKS = new Set(['onCallEnd', 'onRoomLeft', 'onRoomClosed']);

/** CallEngine 是宿主唯一需要接触的类型。 */
export class CallEngine {
  private readonly bus = new EngineBus();
  private readonly bridge: MediaBridge;
  private readonly media: MediaAdapter;
  private readonly options: EngineOptions;

  private readonly sender: FrameSender;
  private connection: Connection | null = null;
  private ctx: EngineContext = initialEngineContext;

  constructor(options: EngineOptions) {
    this.options = options;
    this.media = options.media ?? new WebRTCAdapter();
    this.bridge = new MediaBridge(this.media);
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
    const connection = createConnection(
      {
        url: this.options.url,
        token,
        deviceId: this.options.deviceId,
        ...(this.options.webSocketFactory === undefined
          ? {}
          : { webSocketFactory: this.options.webSocketFactory }),
      },
      {
        onEvent: (type, data): void => void this.handleIncoming(type, data),
        onDisconnected: (info): void => {
          void this.dispatch({ kind: 'internal', name: 'disconnected' });
          // exactOptionalPropertyTypes：code 没有时**不能传 undefined**，只能不写这个键。
          this.bus.emit('disconnected', {
            ...(info.code === undefined ? {} : { code: info.code }),
            willReconnect: info.willReconnect,
          });
        },
        onKickedOut: (): void => void this.dispatch({ kind: 'internal', name: 'ws_closed_4403' }),
        onError: (error): void => this.bus.emitError(error),
      },
    );
    this.connection = connection;
    this.bridge.open(mediaEvents(this.mediaDeps()));

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
    this.bridge.close();
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
    this.bridge.attachView(uid, el);
  }

  /** attachLocalView 把本端某条轨道挂到元素上做预览；传 `null` 卸载。 */
  attachLocalView(cid: string, el: ViewElement | null): void {
    this.bridge.attachLocalView(cid, el);
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
    if (type === 'room.ice_candidate') {
      await addRemoteCandidate(
        this.mediaDeps(),
        (pc, init) => this.media.addRemoteCandidate(pc, init),
        data,
      );
      return; // 候选只关媒体层的事，状态机不认识它
    }
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

    this.bridge.claim(this.ctx.room.remoteTracks);
    // **一通结束就把媒体面归零**，在抛事件之前：宿主收到 onCallEnd 时
    // engine 已经是干净的，下一通不会带着上一通的轨道去协商。
    if (result.emit.some((event) => LEAVE_CALLBACKS.has(event.cb))) this.bridge.reset();

    /*
      **先抛事件、再发帧**，顺序不能反。

      事件说的是「刚刚发生了什么」，帧说的是「接下来要做什么」——反过来的话，
      帧的应答会在本轮事件之前就被处理掉，宿主收到的回调顺序就乱了。
      实测症状：`call.connected` 产出 onCallBegin（事件）与 room.join（帧），
      先发帧的话 join.ok 立刻回来并抛出 onRoomJoined，于是宿主看到的是
      **roomJoined 和 userEnter 排在 callBegin 前面**——它还没被告知有这通电话，
      就先收到了这通电话房间里的事件。
    */
    this.logLocalReject(input, result.emit);
    for (const event of result.emit) {
      /*
        **`onDisconnected` 由连接层独占**，状态机那一份不往外发。

        两边都发的话宿主每次断线收到**两条** `disconnected`，而且状态机那条
        是空载荷的（一致性向量里就是 `args: {}`——它只关心状态怎么走，
        关闭码不是状态机的事）。实测日志里的样子是：一条 `{}`、一条
        `{code:4401,willReconnect:false}`，中间还夹着一条假的 4403——
        那是「鉴权失败到顶」复用了 `ws_closed_4403` 这个内部事件留下的。
        宿主想数重连次数就没法数了。
      */
      if (event.cb === 'onDisconnected') continue;
      this.bus.emitMachine(event);
    }
    for (const frame of result.send) {
      await this.sendFrame(frame);
    }
  }

  /**
   * mediaDeps 是交给媒体接线的那一小把依赖（见 media/mediaPlane.ts）。
   *
   * `connection` 与 `uidOf` 都取成函数：前者会随重连换对象，
   * 后者读的是状态机的当前快照——传值的话拿到的是构造那一刻的旧账。
   */
  private mediaDeps(): MediaPlaneDeps {
    return {
      bridge: this.bridge,
      bus: this.bus,
      sender: this.sender,
      connection: (): Connection | null => this.connection,
      uidOf: (trackId): string => this.ctx.room.remoteTracks[trackId]?.uid ?? '',
      dispatch: (input): Promise<void> => this.dispatch(input),
    };
  }

  /**
   * logLocalReject 把「状态机本地拒掉了一个动作」记成一条**说得清的**日志。
   *
   * 宿主收到的 `onError` 只有 `code=2005 / invalid_state`——**哪个动作、当时什么状态，
   * 一个字都没有**。三人会议那次排查就卡在这里：日志里十几条一模一样的 2005，
   * 要读代码才能推出「点的是挂断、而会议里没有 call」。
   *
   * 不把这些塞进 `onError` 的载荷，是因为那是四端共用的公开回调表；
   * 诊断信息进日志就够了。
   */
  private logLocalReject(input: MachineInput, emit: readonly { cb: string;
    args: Readonly<Record<string, unknown>> }[]): void {
    if (input.kind !== 'act') return;
    const rejected = emit.some(
      (event) => event.cb === 'onError' && event.args['code'] === ErrorCode.invalidState,
    );
    if (!rejected) return;
    logger.warn('动作被状态机本地拒绝', {
      op: input.op,
      call_state: this.ctx.call.state,
      room_state: this.ctx.room.state,
    });
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
      this.bus.emitError(err);
      /*
        **进房失败要把房间状态退回 idle**。

        不退的话状态机永远停在 `joining`，之后每一次 publish 都会被不变量 R1
        本地拒掉（2005 invalid_state），而宿主只看到两条没头没尾的 2005——
        真正的原因（那条 room.join 被服务端拒了）已经淹在上一条 error 里了。
        退回 idle 至少让「重进一次」成为可能。
      */
      if (frame.type === 'room.join') {
        await this.dispatch({ kind: 'internal', name: 'join_failed' });
      }
    }
  }

}

