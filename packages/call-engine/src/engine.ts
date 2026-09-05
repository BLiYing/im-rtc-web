import { EngineBus } from './engineBus.js';
import { ErrorCode, RtcError } from './errors.js';
import { FrameLoop } from './frameLoop.js';
import { logger } from './logger.js';
import type { EngineEventHandler, EngineEventName } from './events.js';
import type { MediaAdapter } from './media/mediaAdapter.js';
import { MediaBridge } from './media/mediaBridge.js';
import type { MediaPlaneDeps } from './media/mediaPlane.js';
import { mediaEvents } from './media/mediaPlane.js';
import type { ViewElement } from './media/viewRegistry.js';
import { WebRTCAdapter } from './media/webrtcAdapter.js';
import type { Connection, HelloOk } from './signaling/connection.js';
import { createConnection } from './signaling/connectionFactory.js';
import type { Layer, MediaType } from './signaling/enums.js';
import { FrameSender } from './signaling/frameSender.js';
import type { WebSocketFactory } from './signaling/webSocket.js';
import type { EngineContext } from './state/engineMachine.js';

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
  private readonly bus = new EngineBus();
  private readonly bridge: MediaBridge;
  private readonly media: MediaAdapter;
  private readonly options: EngineOptions;

  private readonly sender: FrameSender;
  private connection: Connection | null = null;
  /** 握手拿到的自己的 uid。用来挡「呼叫自己」，也供宿主读。 */
  private myUid = '';
  private readonly loop: FrameLoop;
  /** 最近一次 hello.ok 喂进状态机的那个 promise，`login()` 要等它。 */
  private helloApplied: Promise<void> = Promise.resolve();

  constructor(options: EngineOptions) {
    this.options = options;
    this.media = options.media ?? new WebRTCAdapter();
    this.bridge = new MediaBridge(this.media);
    this.sender = new FrameSender(this.media);
    this.loop = new FrameLoop({
      bus: this.bus,
      bridge: this.bridge,
      media: this.media,
      sender: this.sender,
      connection: (): Connection | null => this.connection,
      mediaDeps: (): MediaPlaneDeps => this.mediaDeps(),
    });
  }

  /** on 订阅事件，返回退订函数。事件表见 events.ts（= 设计文档 §7.5）。 */
  on<K extends EngineEventName>(name: K, handler: EngineEventHandler<K>): () => void {
    return this.bus.on(name, handler);
  }

  /** uid 是当前登录的用户。未登录时是空串。 */
  get uid(): string {
    return this.myUid;
  }

  /** state 返回当前的通话与房间状态，供 UI 渲染。 */
  get state(): EngineContext {
    return this.loop.state;
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
        /*
          **握手结果一律从这里进状态机**，`login()` 不再自己喂一遍。

          只在 `login()` 里喂的话，自动重连那次握手就没人接——状态机不知道自己
          重连了（`resumed=false` 时房间与通话不归零、`resumed=true` 时攒下的意图
          不重放），宿主也收不到第二次 `connected`。实测症状：服务端重启后页面
          换票重连其实成功了，界面却一直停在「重连中」。
        */
        onConnected: (hello): void => {
          this.helloApplied = this.loop.dispatch({
            kind: 'recv',
            type: 'sys.hello.ok',
            data: { session_id: hello.sessionId, resumed: hello.resumed },
          });
          void this.helloApplied.catch((err: unknown) => this.bus.emitError(err));
        },
        onEvent: (type, data): void => void this.loop.handleIncoming(type, data),
        onDisconnected: (info): void => {
          void this.loop.dispatch({ kind: 'internal', name: 'disconnected' });
          this.bus.emit('disconnected', info);
        },
        onKickedOut: (): void => void this.loop.dispatch({ kind: 'internal', name: 'ws_closed_4403' }),
        onError: (error): void => this.bus.emitError(error),
      },
    );
    this.connection = connection;
    this.bridge.open(mediaEvents(this.mediaDeps()));

    const hello = await connection.connect();
    this.myUid = hello.uid;
    // 首次登录要等状态机吃完 hello.ok 再返回：宿主拿到 login 的返回值时，
    // engine 的状态应该已经是最终的了。（重连那些不需要等——没人在 await 它们。）
    await this.helloApplied;
    return hello;
  }

  /**
   * updateToken 换一枚新的接入票。**下一次重连时生效，不打断当前连接。**
   *
   * # 为什么是宿主推给我们，而不是我们去要
   *
   * 协议 §1.5 说 `4401` 的处置是「换新 token 后重连」。**换票是宿主的事**——
   * 票从宿主的账号体系来，engine 不认识那套东西，也不该替它决定什么时候去要。
   * 所以这里是 push 不是 pull：没有「token provider 回调」这种设计。
   *
   * # 宿主该怎么用
   *
   * 在 `disconnected` 里看到 `code === 4401` 就去取一枚新票、调这个方法。
   * 重连是已经排好的（第一档 1 秒起），所以**只要在下一次尝试之前调到就行**；
   * 连续 3 次鉴权失败之后 engine 会抛 `kickedOut` 收手，那时就只能重新 `login` 了。
   *
   * 连上着的时候调它也是安全的（比如票快过期了提前换）——当前连接不受影响。
   */
  updateToken(token: string): void {
    this.connection?.updateToken(token);
  }

  /** logout 关掉连接与媒体。 */
  logout(): void {
    this.connection?.close();
    this.connection = null;
    this.bridge.close();
    this.loop.reset();
  }

  /** call 发起通话。 */
  /**
   * call 发起通话。
   *
   * **呼叫名单里不能有自己**——服务端会以 `1004 bad_params` 拒掉
   * （"callee_ids 不能含主叫自己"）。这里在发出去之前就拦下来：那条链路上的失败
   * 很难看懂，界面已经乐观地进了「正在呼叫…」，而错误只是一条没头没尾的 1004。
   * （实测撞过：Demo 的群呼默认名单里正好有登录的那个人。）
   */
  async call(calleeIds: string[], mediaType: MediaType, isGroup = false): Promise<void> {
    if (this.myUid !== '' && calleeIds.includes(this.myUid)) {
      logger.warn('呼叫名单里含自己，已就地拒掉', { uid: this.myUid });
      this.bus.emitError(new RtcError(ErrorCode.badParams));
      return;
    }
    await this.loop.dispatch({
      kind: 'act',
      op: 'call',
      args: { callee_ids: calleeIds, media_type: mediaType, is_group: isGroup },
    });
  }

  /** accept 接听。 */
  async accept(): Promise<void> {
    await this.loop.dispatch({ kind: 'act', op: 'accept' });
  }

  /** reject 拒接。 */
  async reject(): Promise<void> {
    await this.loop.dispatch({ kind: 'act', op: 'reject' });
  }

  /** cancel 取消呼出（**仅接通前**；接通后用 hangup）。 */
  async cancel(): Promise<void> {
    await this.loop.dispatch({ kind: 'act', op: 'cancel' });
  }

  /** hangup 挂断（接通后，主被叫都用它）。 */
  async hangup(): Promise<void> {
    await this.loop.dispatch({ kind: 'act', op: 'hangup' });
  }

  /** joinRoom 直接进一个会议房（不走振铃）。 */
  async joinRoom(roomId: string, roomToken: string, autoSubscribe = true): Promise<void> {
    await this.loop.dispatch({
      kind: 'act',
      op: 'join',
      args: { room_id: roomId, room_token: roomToken, auto_subscribe: autoSubscribe },
    });
  }

  /** leaveRoom 离房。 */
  async leaveRoom(): Promise<void> {
    await this.loop.dispatch({ kind: 'act', op: 'leave' });
  }

  /**
   * publishMicrophone 发布麦克风。
   *
   * 顺序是**先拿轨道再拿 cid**：浏览器不允许自定义 track.id，而服务端靠
   * msid 里的 cid 认领 m-line（协议 §3.2）。
   */
  async publishMicrophone(): Promise<string> {
    const info = await this.media.acquireMicrophone();
    await this.loop.dispatch({
      kind: 'act',
      op: 'publish',
      args: { cid: info.cid, kind: info.kind, source: info.source, simulcast: false },
    });
    return info.cid;
  }

  /** publishCamera 发布摄像头。 */
  async publishCamera(simulcast = true): Promise<string> {
    const info = await this.media.acquireCamera();
    await this.loop.dispatch({
      kind: 'act',
      op: 'publish',
      args: { cid: info.cid, kind: info.kind, source: info.source, simulcast },
    });
    return info.cid;
  }

  /** setMuted 开关本端某条轨道。**不是 unpublish**，协商保留。 */
  async setMuted(cid: string, muted: boolean): Promise<void> {
    this.media.setMuted(cid, muted);
    const trackId = this.loop.state.room.publishTrackIds[cid];
    if (trackId === undefined) return;
    await this.loop.dispatch({ kind: 'act', op: 'mute', args: { track_id: trackId, muted } });
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
    for (const [trackId, info] of Object.entries(this.loop.state.room.remoteTracks)) {
      if (info.uid !== uid || info.kind !== 'video') continue;
      await this.loop.dispatch({
        kind: 'act',
        op: 'update_layer',
        args: { track_id: trackId, max_layer: layer },
      });
    }
  }

  // ── 内部 ──────────────────────────────────────────────

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
      uidOf: (trackId): string => this.loop.state.room.remoteTracks[trackId]?.uid ?? '',
      dispatch: (input): Promise<void> => this.loop.dispatch(input),
    };
  }

}

