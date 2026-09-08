import { EngineBus } from './engineBus.js';
import type { EngineWiring } from './engineWiring.js';
import { engineConnectionHandlers, engineMediaDeps } from './engineWiring.js';
import { ErrorCode, RtcError } from './errors.js';
import { FrameLoop } from './frameLoop.js';
import { logger } from './logger.js';
import { checkDeviceId, checkRoomId } from './protocolId.js';
import { CallEndReason } from './reasons.js';
import type { EngineEventHandler, EngineEventName } from './events.js';
import type { MediaAdapter } from './media/mediaAdapter.js';
import type { MediaApiDeps } from './media/engineMediaApi.js';
import {
  probeMicrophone,
  publishCamera,
  publishMicrophone,
  setMuted,
  setRemoteLayer,
} from './media/engineMediaApi.js';
import { MediaBridge } from './media/mediaBridge.js';
import type { MediaPlaneDeps } from './media/mediaPlane.js';
import { mediaEvents } from './media/mediaPlane.js';
import type { ViewElement } from './media/viewRegistry.js';
import type { VideoProfile } from './media/videoProfile.js';
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
  /**
   * 采集画质档位（360p / 720p / 1080p，默认 720p）。
   *
   * **只对默认媒体适配器生效**——自己传 `media` 的宿主在构造适配器时传它。
   * 画质是宿主策略，不是 RTC 服务端下发的，理由见 `media/videoProfile.ts`。
   */
  videoProfile?: VideoProfile;
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
    // 与 Android 的 `Config.init` 对齐：构造时就拦，不等宿主取完票走到 login()。
    checkDeviceId(options.deviceId);
    this.options = options;
    this.media = options.media ?? new WebRTCAdapter(undefined, options.videoProfile);
    this.bridge = new MediaBridge(this.media);
    this.sender = new FrameSender(this.media);
    this.loop = new FrameLoop({
      bus: this.bus,
      bridge: this.bridge,
      media: this.media,
      sender: this.sender,
      connection: (): Connection | null => this.connection,
      mediaDeps: (): MediaPlaneDeps => engineMediaDeps(this.wiring()),
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
      engineConnectionHandlers(this.wiring(), (applied): void => {
        this.helloApplied = applied;
      }),
    );
    this.connection = connection;
    this.bridge.open(mediaEvents(engineMediaDeps(this.wiring())));

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
  updateToken(token: string, expiresAtMs?: number): void {
    this.connection?.updateToken(token, expiresAtMs);
  }

  /** logout 关掉连接与媒体。 */
  logout(): void {
    this.connection?.close();
    this.connection = null;
    this.bridge.close();
    this.loop.reset();
  }

  /** call 发起通话。**名单里不能有自己**，见 {@link rejectsSelf}。 */
  async call(calleeIds: string[], mediaType: MediaType, isGroup = false): Promise<void> {
    if (this.rejectsSelf(calleeIds, '呼叫')) {
      /*
        **本地拒掉也要给界面一个出口。**

        调用方（uikit / 宿主）在调 `call()` 之前就已经切到「正在呼叫…」了——
        这是对的，不然按下去几百毫秒没反应。但只抛一个 error 事件，
        界面不知道该退回哪儿：实测三人测试里 carol 卡在「正在呼叫…」，
        连点五次挂断收到五个 2005（状态机是 idle，没有 call 可挂），
        除了刷新页面没有别的出路。

        `callEnd` 是所有结束分支的唯一出口（设计 §7.5），
        这一条与「服务端拒了 invite」（call_failed）走同一个出口，界面只认它。
      */
      this.bus.emit('callEnd', {
        callId: '',
        reason: CallEndReason.error,
        durationSec: 0,
        endedBy: '',
      });
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

  /**
   * inviteMore 往进行中的群通话里再拉人（协议 §4.1 `call.invite_more`）。
   * 名单里同样不能有自己，见 {@link rejectsSelf}。
   *
   * **只有主叫能发**——非主叫会被服务端拒成 `1407 not_call_owner`，
   * 所以界面上那个「添加成员」入口对非主叫根本不该显示（交互稿 §05）。
   * 房间满了回 `1202 room_full`。
   */
  async inviteMore(calleeIds: string[]): Promise<void> {
    if (this.rejectsSelf(calleeIds, '加人')) return;
    await this.loop.dispatch({ kind: 'act', op: 'invite_more', args: { callee_ids: calleeIds } });
  }

  /**
   * probeMicrophone 在拨出 / 接听**之前**探一下麦克风权限（交互稿 §01）。
   *
   * 拿到就放掉，不占设备；被拒抛 `2001`、没设备抛 `2002`。
   * 摄像头那一侧用 `startLocalPreview` 探——它本来就该在拨出时起来给人看见自己。
   */
  async probeMicrophone(): Promise<void> {
    await probeMicrophone(this.mediaApi());
  }

  /** joinRoom 直接进一个会议房（不走振铃）。 */
  async joinRoom(roomId: string, roomToken: string, autoSubscribe = true): Promise<void> {
    // 宿主指定的房间号同属 §2.5，不拦的话又是一条「1004 但不说为什么」。
    checkRoomId(roomId);
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

  /** publishMicrophone 发布麦克风，返回轨道的 cid。 */
  async publishMicrophone(): Promise<string> {
    return publishMicrophone(this.mediaApi());
  }

  /**
   * startLocalPreview 只起本端采集，**不发布**（设计文档 §7.5，四端同名）。
   *
   * 拨出中还没有房间，推流无从谈起，但界面这时就该让人看见自己（草图 §03-E）。
   * 随后的 `publishCamera` 复用这条轨道，不会把摄像头开第二次。
   *
   * 返回轨道的 cid，宿主拿它调 `attachLocalView`。
   */
  async startLocalPreview(): Promise<string> {
    const info = await this.media.startLocalPreview();
    return info.cid;
  }

  /** publishCamera 发布摄像头。已经在预览的话复用那条轨道。 */
  async publishCamera(simulcast = true): Promise<string> {
    return publishCamera(this.mediaApi(), simulcast);
  }

  /** setMuted 开关本端某条轨道。**不是 unpublish**，协商保留。 */
  async setMuted(cid: string, muted: boolean): Promise<void> {
    await setMuted(this.mediaApi(), cid, muted);
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
    await setRemoteLayer(this.mediaApi(), uid, layer);
  }

  // ── 内部 ──────────────────────────────────────────────

  /**
   * rejectsSelf 挡住「名单里有自己」，就地报错并返回 true。
   *
   * 服务端会以 `1004 bad_params` 拒掉（"callee_ids 不能含主叫自己"），但那条链路上的
   * 失败很难看懂：界面已经乐观地进了「正在呼叫…」，而错误只是一条没头没尾的 1004。
   * （实测撞过：Demo 的群呼默认名单里正好有登录的那个人。）
   *
   * **一份实现供 call 与 inviteMore 共用**——两处各写一遍的话，改了一处忘了另一处，
   * 就又是一个「同一条规则在一处成立、另一处不成立」。
   */
  private rejectsSelf(calleeIds: string[], what: string): boolean {
    if (this.myUid === '' || !calleeIds.includes(this.myUid)) return false;
    logger.warn(`${what}名单里含自己，已就地拒掉`, { uid: this.myUid });
    this.bus.emitError(new RtcError(ErrorCode.badParams));
    return true;
  }

  /** mediaApi 是交给 media/engineMediaApi 那几个编排函数的一把依赖。 */
  private mediaApi(): MediaApiDeps {
    return { media: this.media, loop: this.loop, bus: this.bus };
  }

  /**
   * wiring 是交给 engineWiring 那两个装配函数的一把依赖。
   *
   * 每次现造一个：里面的 `connection` 是闭包，读的永远是**当前**那条连接
   * ——它会随重连换对象。
   */
  private wiring(): EngineWiring {
    return {
      bus: this.bus,
      bridge: this.bridge,
      sender: this.sender,
      loop: this.loop,
      connection: (): Connection | null => this.connection,
    };
  }
}

