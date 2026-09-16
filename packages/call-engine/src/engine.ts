import { byteLength } from './bytes.js';
import type { CallOptions } from './callOptions.js';
import { violatesCallOptionLimits } from './callOptions.js';
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
  probeCamera,
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

export type { CallOptions } from './callOptions.js';

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
  /** 终态销毁标记。见 {@link destroy}。 */
  private destroyed = false;

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

  /**
   * login 建立信令连接并完成握手。
   *
   * # 重复调用会被拒掉
   *
   * **两条 WS 带着同一个 uid + device_id，服务端按顶号把先来的那条踢下线**，于是宿主收到
   * 一个**假的 `kickedOut{takenOver}`**——「账号在别处登录」，可根本没有别处，就是这台
   * 机器自己把自己踢了。更隐蔽的是旧那条**从不 close**：它的 `ResumeDeadline` 在第一次
   * 断开时就已经武装好（只有 `close()` 撤得掉），约 75 秒后照样触发 `onSessionUnrecoverable`，
   * 把**新会话**的房间清成 idle 并合成一条 `onCallEnd(network)`——用户刚换票重登、
   * 正通着话，画面无故收场。而 `events.ts` 恰恰建议宿主在 `kickedOut{authExpired}` 之后
   * 「取一枚新票再 login」，正好走的就是这条路。
   *
   * 要换账号或换一枚票，先 `logout()`。（连着的时候换票用 {@link updateToken}。）
   * iOS 的 `login(_:)` 早就是这条规矩，本端是没跟上的那个。
   *
   * # 失败会把摊子收干净
   *
   * 握手失败时把连接关掉、`connection` 置回 null。不收的话上面那道门会把**重试**
   * 也一起挡掉，用户从此再也登不上——比原来的毛病还糟。
   */
  async login(token: string): Promise<HelloOk> {
    this.assertNotDestroyed();
    if (this.connection !== null) {
      throw new RtcError(ErrorCode.invalidState, {
        cause: new Error('已经登录了：换账号或换票请先 logout()'),
      });
    }
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

    let hello: HelloOk;
    try {
      hello = await connection.connect();
    } catch (err) {
      // 收摊：不收的话上面那道「已经登录了」的门会把重试也挡掉。
      connection.close();
      this.bridge.close();
      if (this.connection === connection) this.connection = null;
      throw err;
    }
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

  /**
   * destroy 终态销毁：`logout()` + 清空全部事件订阅。**不可逆**，给宿主整个放手音视频能力时用
   * （账号注销、SDK 卸载）。**可重复调用**——已经销毁过再调什么都不做，不会重复 logout。
   *
   * # 之后再调别的方法
   *
   * 会发起动作的方法（`login` / `call` / `accept` / … / `publishMicrophone` / `openCamera` 等，
   * 经 {@link act} 或 {@link mediaApi} 转发的那一批）一律**抛 `2005 invalid_state`**，
   * 不是静默空操作：事件订阅已经清空，静默的话宿主的 `hangup()` 之类调用会石沉大海——
   * 不抛错也不会有任何事件把原因告诉它，界面只会永远停在转圈。与 `login()` 拦
   * 「已经登录了」同一个理由：让宿主一调就知道错在哪，不用猜。
   *
   * `logout()` / `forceEnd()` / `on()` / `uid` / `state`，以及读或清理类的方法
   * （`attachView` 传 `null`、`attachLocalView` 传 `null`、`localTrack`、`stopLocalPreview`、
   * `updateToken`）**不受影响**，销毁后调用仍然安全——宿主卸载时经常无脑清理这几个，
   * 不该因为清理顺序先后而报错。
   */
  destroy(): void {
    if (this.destroyed) return;
    this.logout();
    this.bus.clear();
    this.destroyed = true;
  }

  /**
   * assertNotDestroyed 挡住 {@link destroy} 之后的调用。见 destroy 的文档注释。
   */
  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new RtcError(ErrorCode.invalidState, { cause: new Error('engine 已销毁（destroy 之后不可再用）') });
    }
  }

  /**
   * act 是「发一个业务动作、等状态机处理完」的公共外壳：`call` / `accept` / `reject` / `cancel` /
   * `hangup` / `inviteMore` / `joinCall` / `joinRoom` / `leaveRoom` 共用，唯一的区别只是
   * op 名与参数。抽出来顺带把 {@link assertNotDestroyed} 的检查收在一处。
   */
  private async act(op: string, args?: Record<string, unknown>): Promise<void> {
    this.assertNotDestroyed();
    await this.loop.dispatch(args === undefined ? { kind: 'act', op } : { kind: 'act', op, args });
  }

  /**
   * call 发起通话。**名单里不能有自己**，见 {@link rejectsSelf}。
   *
   * `options` 传布尔值等同旧的 `isGroup` 参数（三参数签名保持兼容）；传 {@link CallOptions}
   * 可以带上群号 / user_data / 振铃超时（HOST_INTEGRATION_DESIGN §3.3）。
   */
  async call(
    calleeIds: string[],
    mediaType: MediaType,
    options?: boolean | CallOptions,
  ): Promise<void> {
    this.assertNotDestroyed();
    const opts: CallOptions = typeof options === 'boolean' ? { isGroup: options } : (options ?? {});
    const isGroup = opts.isGroup ?? false;
    const chatGroupId = opts.chatGroupId ?? '';
    const userData = opts.userData ?? '';

    if (this.rejectsSelf(calleeIds, '呼叫') || this.rejectsBadCallOptions(chatGroupId, userData)) {
      /*
        **本地拒掉也要给界面一个出口。**

        调用方（uikit / 宿主）在调 `call()` 之前就已经切到「正在呼叫…」了——
        这是对的，不然按下去几百毫秒没反应。但只抛一个 error 事件，
        界面不知道该退回哪儿：实测三人测试里 carol 卡在「正在呼叫…」，
        连点五次挂断收到五个 2005（状态机是 idle，没有 call 可挂），
        除了刷新页面没有别的出路。

        `callEnd` 是所有结束分支的唯一出口（设计 §7.5），
        这一条与「服务端拒了 invite」（call_failed）走同一个出口，界面只认它。
        chatGroupId / userData 超限走同一个出口——不上线路，理由同上。
      */
      this.bus.emit('callEnd', {
        callId: '',
        reason: CallEndReason.error,
        durationSec: 0,
        endedBy: '',
      });
      return;
    }
    const args: Record<string, unknown> = { callee_ids: calleeIds, media_type: mediaType, is_group: isGroup };
    // 省略表达「没传」，见 callMachine.ts startCall 的同一条注释。
    if (chatGroupId !== '') args['chat_group_id'] = chatGroupId;
    if (userData !== '') args['user_data'] = userData;
    if (opts.timeoutSec !== undefined) args['timeout_sec'] = opts.timeoutSec;
    await this.act('call', args);
  }

  /**
   * joinCall 是「群成员看到『进行中』主动加入」（协议 §4.1 `call.join`）。
   *
   * **「怎么知道有通话在进行中」不是 engine 的事**——宿主拿 webhook `call.started`
   * 或后台 `GET /v1/calls?chat_group_id=...&active=1` 自己判断、自己摆横幅。
   * 服务端拒绝（不存在 / 已结束 / 满员 / 本人已在通话中 / 宿主邀请鉴权回调拒绝 1409）
   * 时与 `call()` 被拒同一个出口：`onError` + `onCallEnd(error)`。
   */
  async joinCall(callId: string): Promise<void> {
    await this.act('join_call', { call_id: callId });
  }

  /** accept 接听。 */
  async accept(): Promise<void> {
    await this.act('accept');
  }

  /** reject 拒接。 */
  async reject(): Promise<void> {
    await this.act('reject');
  }

  /** cancel 取消呼出（**仅接通前**；接通后用 hangup）。 */
  async cancel(): Promise<void> {
    await this.act('cancel');
  }

  /** hangup 挂断（接通后，主被叫都用它）。 */
  async hangup(): Promise<void> {
    await this.act('hangup');
  }

  /**
   * forceEnd 强制结束当前这一场：**结束帧立刻上线路，本地立刻收场，不等服务端**（设计文档 §7.5，五端同名）。
   *
   * 给「红键按下去、等不到结束事件」用——uikit 的红键看门狗 3 秒到点就调它。宿主自画 UI 时同理：
   * `hangup()` 发出去几秒没收到 `callEnd`，就调这个。同步、不抛。
   *
   * 与 `hangup()` 的区别：`hangup()` 只发帧、等服务端的 `call.ended` 推进状态（§5.1），
   * 帧没发出去或被拒了，这一场就收不掉（2026-09-13 iOS frank：界面收了，人还挂在房里四分钟）。
   * `forceEnd()` 不等：按此刻状态挑结束帧（通话中 hangup、响铃中 reject、拨出中 cancel、
   * 会议里 room.leave）**直接交给信令连接**，再本地收场并抛 `callEnd` / `roomLeft`；
   * 服务端随后的 `call.ended` 会因为本地已是 idle 被静默丢弃，不会抛第二次。
   *
   * 收场之后才到的东西也兜住了：迟到的 `room.join.ok` 补发 `room.leave`（服务端只验房票、
   * 不查通话成员），迟到的 `call.invite.ok` 补发 `call.cancel`、`call.connected` 补发 `call.hangup`，
   * 迟到的候选与 SDP 不再交给媒体层。
   *
   * **已知限制**：没登录 / 连接断着时帧发不出去，只做本地收场；服务端那边由恢复窗口到期兜底。
   */
  forceEnd(): void {
    this.loop.forceEnd();
  }

  /**
   * inviteMore 往进行中的群通话里再拉人（协议 §4.1 `call.invite_more`）。
   * 名单里同样不能有自己，见 {@link rejectsSelf}。
   *
   * **通话里的任何人都能发**（2026-09-15 起，原先仅主叫）；还在响铃 / 已离场的人发会被服务端拒成
   * `1407 not_call_owner`（交互稿 §05）。房间满了回 `1202 room_full`；离场的发起人也能被重新邀请。
   */
  async inviteMore(calleeIds: string[]): Promise<void> {
    this.assertNotDestroyed();
    if (this.rejectsSelf(calleeIds, '加人')) return;
    await this.act('invite_more', { callee_ids: calleeIds });
  }

  /**
   * probeMicrophone 在拨出 / 接听**之前**探一下麦克风权限（交互稿 §01）。
   *
   * 拿到就放掉，不占设备；被拒抛 `2001`、没设备抛 `2002`。
   */
  async probeMicrophone(): Promise<void> {
    await probeMicrophone(this.mediaApi());
  }

  /**
   * probeCamera 只探摄像头权限，**不起预览**。契约同 `probeMicrophone`。
   *
   * 摄像头默认关着的场合（群通话、来电页上关掉了摄像头）也可能要先问权限，
   * 拿预览去探会把摄像头真的打开。要看见自己另调 `startLocalPreview`。
   */
  async probeCamera(): Promise<void> {
    await probeCamera(this.mediaApi());
  }

  /** joinRoom 直接进一个会议房（不走振铃）。 */
  async joinRoom(roomId: string, roomToken: string, autoSubscribe = true): Promise<void> {
    this.assertNotDestroyed();
    // 宿主指定的房间号同属 §2.5，不拦的话又是一条「1004 但不说为什么」。
    checkRoomId(roomId);
    await this.act('join', { room_id: roomId, room_token: roomToken, auto_subscribe: autoSubscribe });
  }

  /** leaveRoom 离房。 */
  async leaveRoom(): Promise<void> {
    await this.act('leave');
  }

  /** publishMicrophone 发布麦克风，返回轨道的 cid。 */
  async publishMicrophone(): Promise<string> {
    return publishMicrophone(this.mediaApi());
  }

  /**
   * openMicrophone 是麦克风开关的**按类型**便捷接口（与腾讯 TUICallEngine 同名）。
   *
   * 这条轨道还没发布过就发布（等价 `publishMicrophone()`）；已经发布了就取消静音，
   * **不会重新发布**——重复发布同一路麦克风会在 pub PC 上多挂一条 sender。
   *
   * 「发没发布过」问的是**媒体适配器自己的账**（`media.publishedMicrophoneCid()`），
   * 不在门面另开一份：宿主先直接调 `publishMicrophone()` 发布过、再调这个方法的话，
   * 门面自己那份账不知道已经发布过，会误判成「没发布」再发一次（2026-09-15 iOS 踩过）。
   * `publishMicrophone()` / `setMuted(cid)` 仍然保留，给需要自己管 cid 的宿主用。
   */
  async openMicrophone(): Promise<void> {
    const cid = this.media.publishedMicrophoneCid();
    if (cid !== null) {
      await this.setMuted(cid, false);
      return;
    }
    await this.publishMicrophone();
  }

  /**
   * closeMicrophone 关麦克风：对已发布的那条轨道 `setMuted(cid, true)`——**不 unpublish**，
   * 协商保留。没发布过是空操作。
   */
  async closeMicrophone(): Promise<void> {
    const cid = this.media.publishedMicrophoneCid();
    if (cid !== null) await this.setMuted(cid, true);
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
    this.assertNotDestroyed();
    const info = await this.media.startLocalPreview();
    return info.cid;
  }

  /**
   * stopLocalPreview 进房前关摄像头：**真的停采集**，指示灯灭（设计文档 §7.5）。
   *
   * 只停还没发布的预览；已发布的摄像头走 `setMuted`。再打开时重新 `startLocalPreview`，cid 会变。
   */
  async stopLocalPreview(): Promise<void> {
    await this.media.stopLocalPreview();
    this.bridge.refreshLocalViews();
  }

  /** publishCamera 发布摄像头。已经在预览的话复用那条轨道。 */
  async publishCamera(simulcast = true): Promise<string> {
    return publishCamera(this.mediaApi(), simulcast);
  }

  /**
   * openCamera 是摄像头开关的**按类型**便捷接口。还没发布就发布（有本端预览时复用它，
   * 同 `publishCamera()` 现有逻辑）；已发布就取消静音——通话中开关摄像头走的是
   * `setMuted` 既有的「关停采集、开重新采集换 sender」语义，不重新协商。
   *
   * 「发没发布过」同样问媒体适配器自己的账（`media.publishedCameraCid()`），
   * 理由见 {@link openMicrophone}。
   */
  async openCamera(): Promise<void> {
    const cid = this.media.publishedCameraCid();
    if (cid !== null) {
      await this.setMuted(cid, false);
      return;
    }
    await this.publishCamera();
  }

  /** closeCamera 关摄像头：`setMuted(cid, true)`（停采集，指示灯灭；不 unpublish）。没发布过是空操作。 */
  async closeCamera(): Promise<void> {
    const cid = this.media.publishedCameraCid();
    if (cid !== null) await this.setMuted(cid, true);
  }

  /**
   * setMuted 开关本端某条轨道。**不是 unpublish**，协商保留。
   *
   * 摄像头关 = 停采集（指示灯灭），开 = 重新采集换上去，cid 不变；重新采集失败时抛 RtcError。
   */
  async setMuted(cid: string, muted: boolean): Promise<void> {
    await setMuted(this.mediaApi(), cid, muted);
    this.bridge.refreshLocalViews();
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

  /**
   * rejectsBadCallOptions 挡住超限的 `chatGroupId` / `userData`，就地报错并返回 true。
   *
   * 服务端会以 `1004 bad_params` 拒掉，但那条链路上主叫已经乐观地进了「正在呼叫…」，
   * 错误只是一条没头没尾的 1004——与 {@link rejectsSelf} 同一个理由，本地先拦，
   * 走同一个出口（HOST_INTEGRATION_DESIGN §3.3）。判断本身在 `callOptions.ts`
   * （纯函数，直接单测）；这里只管日志与出口这两件带副作用的事。
   */
  private rejectsBadCallOptions(chatGroupId: string, userData: string): boolean {
    if (!violatesCallOptionLimits(chatGroupId, userData)) return false;
    logger.warn('chatGroupId / userData 超限，已就地拒掉', {
      chatGroupId, userDataBytes: byteLength(userData),
    });
    this.bus.emitError(new RtcError(ErrorCode.badParams));
    return true;
  }

  /** mediaApi 是交给 media/engineMediaApi 那几个编排函数的一把依赖。 */
  private mediaApi(): MediaApiDeps {
    this.assertNotDestroyed();
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

