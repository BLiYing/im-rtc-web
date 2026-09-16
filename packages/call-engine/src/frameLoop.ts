import type { EngineBus } from './engineBus.js';
import { ErrorCode, RtcError } from './errors.js';
import { LogField, logger } from './logger.js';
import type { MediaAdapter } from './media/mediaAdapter.js';
import type { MediaBridge } from './media/mediaBridge.js';
import type { MediaPlaneDeps } from './media/mediaPlane.js';
import { addRemoteCandidate } from './media/mediaPlane.js';
import { CallEndReason } from './reasons.js';
import type { CallEndReasonValue } from './reasons.js';
import { toFrameProps } from './signaling/caseMapping.js';
import type { Connection } from './signaling/connection.js';
import type { FrameSender } from './signaling/frameSender.js';
import { lookupFrame } from './signaling/registry.js';
import type { EngineContext } from './state/engineMachine.js';
import { initialEngineContext, reduceEngine } from './state/engineMachine.js';
import { forceEnd as planForceEnd } from './state/forceEnd.js';
import type { EmittedEvent, MachineInput, MachineOutput, OutgoingFrame } from './state/types.js';

/**
 * engine 的**核心循环**：输入喂进状态机 → 产出的帧发出去 → 应答再喂回来。
 *
 * 从 `engine.ts` 拆出来的理由是体量红线（CONVENTIONS §2），但这一刀本来就该切：
 * 门面负责的是**对宿主的那张 API 表**，这里负责的是**状态机与线路之间的往返**。
 * 状态机的当前快照也归这里管——它是这个循环的状态，不是门面的字段。
 */

/**
 * LEAVE_CALLBACKS 是「这一轮媒体到此为止」的信号。
 *
 * 三个都要算：通话正常结束、自己离房、房间被服务端关掉。
 * 少算一个的后果是同一条：下一次进房带着上一轮的 PeerConnection。
 */
const LEAVE_CALLBACKS = new Set(['onCallEnd', 'onRoomLeft', 'onRoomClosed']);

/** LATE_MEDIA_FRAMES 是交给媒体层之前要先看房间还在不在的那几帧。见 `handleIncoming` 开头。 */
const LATE_MEDIA_FRAMES = new Set(['room.ice_candidate', 'room.offer', 'room.answer']);

/** SLOW_REQUEST_MS：请求往返超过这么久记一条。正常是几十毫秒。 */
const SLOW_REQUEST_MS = 2_000;

/** FrameLoopDeps 是这个循环要用到的全部东西。 */
export interface FrameLoopDeps {
  readonly bus: EngineBus;
  readonly bridge: MediaBridge;
  readonly media: MediaAdapter;
  readonly sender: FrameSender;
  /** 当前连接；没登录时为 null。取成函数是因为它会随重连换对象。 */
  connection: () => Connection | null;
  /** 媒体接线的依赖袋（见 media/mediaPlane.ts）。 */
  mediaDeps: () => MediaPlaneDeps;
}

/** FrameLoop 持有状态机快照，并驱动它。 */
export class FrameLoop {
  private ctx: EngineContext = initialEngineContext;

  constructor(private readonly deps: FrameLoopDeps) {}

  /** state 是状态机的当前快照，供门面转给 UI。 */
  get state(): EngineContext {
    return this.ctx;
  }

  /** reset 把状态机归零（logout 用）。 */
  reset(): void {
    this.ctx = initialEngineContext;
  }

  /**
   * handleIncoming 是**所有下行帧的唯一入口**——事件与应答都走它。
   *
   * 这里曾经漏了应答那一半：`.ok` 走的是 `request()` 的 Promise，没喂回状态机，
   * 于是 `room.join` 发出去了、`room.join.ok` 回来了，房间状态却永远停在 `joining`，
   * 随后的 publish 全被 R1「只有 joined 才允许发布」本地拒掉。
   */
  async handleIncoming(type: string, data: Record<string, unknown>): Promise<void> {
    const { media, sender } = this.deps;
    /*
      **房间已经不在了，迟到的媒体帧不许交给媒体层。**

      强制收场、通话结束之后才到的候选或 SDP 要是照常交下去，媒体层会在一个没人要的房间上
      继续协商、甚至把 PeerConnection 重新建起来，一直挂到下一次关媒体。
      状态机那一侧由房间机的 idle 分支丢弃（`roomRecv.ts` 的 `handleLateFrame`）。
    */
    if (this.ctx.room.state === 'idle' && LATE_MEDIA_FRAMES.has(type)) {
      logger.debug('房间已不在，丢弃迟到的媒体帧', { type });
      return;
    }
    if (type === 'room.ice_candidate') {
      await addRemoteCandidate(
        this.deps.mediaDeps(),
        (pc, init) => media.addRemoteCandidate(pc, init),
        data,
      );
      return; // 候选只关媒体层的事，状态机不认识它
    }
    if (type === 'room.offer' && data['pc'] === 'sub') {
      sender.noteSubOffer(typeof data['sdp'] === 'string' ? data['sdp'] : '');
    }
    if (type === 'room.answer' && data['pc'] === 'pub') {
      // 先把 SDP 应用到媒体层，再让状态机把发布状态推进到 published。
      await media.applyPubAnswer(typeof data['sdp'] === 'string' ? data['sdp'] : '');
    }
    await this.dispatch({ kind: 'recv', type, data });
  }

  /** dispatch 把一个输入喂进状态机，然后发帧、抛事件。 */
  async dispatch(input: MachineInput): Promise<void> {
    await this.apply(reduceEngine(this.ctx, input), input);
  }

  /**
   * forceEnd 强制收掉当前这一场：**先把结束帧直接交给信令连接，再在本地收场**（`CallEngine.forceEnd`）。
   *
   * # 为什么不走 dispatch
   *
   * dispatch 产出的帧要排在 `sendFrame` 的 await 链上——前面要是还有一个在途请求
   * （比如迟迟没回的 room.join），结束帧就跟着一起卡住。2026-09-13 iOS frank 那次
   * `call.hangup` 一帧都没到服务端，卡的正是这一段。所以帧走 `Connection.fire`，
   * 在这次调用里就同步写进 socket。
   *
   * # 为什么这里不用比对「是不是同一场」
   *
   * 算帧与本地收场在同一次同步调用里完成，中间不会插进别的帧（iOS 那边隔着 actor 才要比对）。
   * 拨出中还没拿到 call_id 的，此刻发不了 cancel：本地照样收场，
   * 那条 invite.ok 迟到时由通话机的 idle 分支补发（`callRecv.ts` 的 `handleLateFrame`）。
   */
  forceEnd(nowMs: number = Date.now(), reason?: CallEndReasonValue): void {
    const plan = planForceEnd(this.ctx, nowMs, reason);
    if (plan.emit.length === 0) {
      logger.info('强制收场：没有进行中的通话或房间', {});
      return;
    }
    logger.warn('强制收场', {
      [LogField.callId]: this.ctx.call.callId,
      call_state: this.ctx.call.state,
      [LogField.roomId]: this.ctx.room.roomId,
      room_state: this.ctx.room.state,
      frames: plan.send.map((frame) => frame.type).join(','),
    });
    this.fireFrames(plan.send);
    // 结束帧已经直发过了，这里只落状态与事件；apply 的同步前半段（记状态、关媒体、抛事件）当场跑完。
    this.apply({ state: plan.state, send: [], emit: plan.emit }).catch((err: unknown) =>
      this.deps.bus.emitError(err),
    );
  }

  /** fireFrames 把结束帧直接交给信令连接，不等应答。 */
  private fireFrames(frames: readonly OutgoingFrame[]): void {
    const connection = this.deps.connection();
    if (connection === null) {
      if (frames.length > 0) logger.warn('强制收场：没有信令连接，结束帧发不出去，只做本地收场', {});
      return;
    }
    for (const frame of frames) {
      const fields = lookupFrame(frame.type);
      if (fields !== undefined) connection.fire(frame.type, fields, toFrameProps(fields, frame.data));
    }
  }

  /**
   * apply 把一次推进的结果落地：记状态、同步媒体层、抛事件、发帧。
   *
   * **发帧之前的部分都是同步的**——`forceEnd` 靠这一点在调用返回前就把事件抛完。
   */
  private async apply(result: MachineOutput<EngineContext>, input?: MachineInput): Promise<void> {
    const { bus, bridge } = this.deps;
    this.ctx = result.state;

    // 认领新到的远端轨道，**并把状态机里已经没有的那些摘掉**（见 syncRemoteTracks）。
    bridge.syncRemoteTracks(this.ctx.room.remoteTracks);
    // **一通结束就把媒体面归零**，在抛事件之前：宿主收到 onCallEnd 时
    // engine 已经是干净的，下一通不会带着上一通的轨道去协商。
    if (result.emit.some((event) => LEAVE_CALLBACKS.has(event.cb))) bridge.reset();

    /*
      **先抛事件、再发帧**，顺序不能反。

      事件说的是「刚刚发生了什么」，帧说的是「接下来要做什么」——反过来的话，
      帧的应答会在本轮事件之前就被处理掉，宿主收到的回调顺序就乱了。
      实测症状：`call.connected` 产出 onCallBegin（事件）与 room.join（帧），
      先发帧的话 join.ok 立刻回来并抛出 onRoomJoined，于是宿主看到的是
      **roomJoined 和 userEnter 排在 callBegin 前面**——它还没被告知有这通电话，
      就先收到了这通电话房间里的事件。
    */
    if (input !== undefined) this.logLocalReject(input, result.emit);
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
      /*
        **`onKickedOut` 同理由连接层独占。**

        状态机那一份也是空载荷的，而宿主真正需要的是**为什么被踢**：
        `takenOver`（被顶号/被吊销，回登录页）与 `authExpired`（票的问题，换票重来）
        处置完全相反。状态机不可能知道这个——它只收到一个 `ws_closed_4403` 内部事件，
        而「鉴权失败到顶」也复用了同一个内部事件（见上面那段注释）。
        两边都发的话宿主会收到两条 kickedOut，其中一条还没有 reason。
      */
      if (event.cb === 'onKickedOut') continue;
      bus.emitMachine(event);
    }
    /*
      有人开了摄像头：等他的**新画面真的上屏**再抛一次 firstVideoFrame（见 `FirstFrameGate`）。
      放在抛事件之后——界面先收到 userVideoAvailable 记成「等画面」，再等这一帧来揭示。
    */
    for (const uid of videoTurnedOn(result.emit)) {
      bridge.awaitFirstVideoFrame(uid, (trackId) => bus.emit('firstVideoFrame', { uid, trackId }));
    }
    for (const frame of result.send) {
      await this.sendFrame(frame);
    }
  }

  /** sendFrame 发一帧，并把应答喂回状态机。 */
  private async sendFrame(frame: OutgoingFrame): Promise<void> {
    const connection = this.deps.connection();
    /*
      **没有连接不是「什么都不做」，是一次失败。**

      原先这里是裸的 `if (connection === null) return`：状态机已经迁移过了，帧却没发出去，
      既不回滚也不报错。宿主在 `login()` 之前（或 `logout()` 之后）调一次 `call()`，
      通话机就永久停在 `inviting`——界面「正在呼叫…」转个不停，之后 `hangup()` 被本地
      拒成 2005、`cancel()` 产出的帧同样被丢掉，**再也回不到 idle**，下一通真电话也被
      2005 挡住。走下面这条收场路径之后，宿主拿到的是一条 `2007 not_logged_in`
      加一次正常的 `callEnd`，界面收得掉。（Android 的 `IMSignalConnection.request`
      未连接时就是立刻回 `NOT_LOGGED_IN`，本端这个码定义了却一直没人用。）
    */
    if (connection === null) {
      const err = new RtcError(ErrorCode.notLoggedIn, { forType: frame.type });
      this.deps.bus.emitError(err);
      await this.rollback(frame);
      return;
    }
    const startedMs = Date.now();
    try {
      const reply = await this.deps.sender.send(connection, frame.type, frame.data);
      noteSlowRequest(frame.type, startedMs, false);
      // **应答也要喂回状态机**：join.ok / publish.ok 都是状态推进的关键一步。
      if (reply !== null) await this.handleIncoming(reply.type, reply.data);
    } catch (err) {
      noteSlowRequest(frame.type, startedMs, true);
      // 请求失败不该中断整个事件流：转成 error 事件交给宿主。
      this.deps.bus.emitError(err);
      await this.rollback(frame);
    }
  }

  /**
   * rollback 把「这一帧没送到」翻译成状态机能收场的内部事件。
   *
   * **一张表管住所有中间态**：留在中间态的代价永远是同一种——界面停在一个转圈的屏上，
   * 而之后每一个动作都被不变量本地拒成 2005，宿主只看到一串没头没尾的 2005，
   * 真正的原因早淹在上一条 error 里了。四端同一张表（Android 的
   * `IMCallEngine.onRequestFailed`、iOS 的 `IMFrameLoop.sendFrame`）。
   */
  private async rollback(frame: OutgoingFrame): Promise<void> {
    const { type } = frame;
    /*
      呼叫 / 接听 / 主动加入被拒都要退回 idle。

      `call.invite` 不退的话界面停在「正在呼叫…」，而服务端根本没有这通电话，
      之后每次挂断都换回 1401 call_not_found，用户永远退不出那一屏。
      **`call.accept` 与 `call.join` 是后补的**：被拒时通话机滞留在 `accepting`，
      而 `reject()` 要求 `ringing`——来电屏上两个按钮全都点不动，一个出口都没有。
    */
    if (type === 'call.invite' || type === 'call.accept' || type === 'call.join') {
      await this.dispatch({ kind: 'internal', name: 'call_failed' });
      return;
    }
    /*
      **进房失败要把房间状态退回 idle**。

      不退的话状态机永远停在 `joining`，之后每一次 publish 都会被不变量 R1
      本地拒掉（2005 invalid_state），而宿主只看到两条没头没尾的 2005——
      真正的原因（那条 room.join 被服务端拒了）已经淹在上一条 error 里了。
      退回 idle 至少让「重进一次」成为可能。
    */
    if (type === 'room.join') {
      await this.dispatch({ kind: 'internal', name: 'join_failed' });
      return;
    }
    /*
      **离房被拒也要退回 idle**：服务端在「会话已不在房间里」时回 1203，
      而那正说明我们已经不在房里了。不接这一条的话房间永久停在 `leaving`——
      `onRoomLeft` 抛不出来，于是 `LEAVE_CALLBACKS` 不命中、`bridge.reset()` 不跑，
      **摄像头与麦克风一直开着**，而之后每次 join / leave 都被本地拒成 2005，
      这台 engine 除非 logout 否则再也进不了房。
    */
    if (type === 'room.leave') {
      await this.dispatch({ kind: 'internal', name: 'leave_failed' });
      return;
    }
    /*
      **发布被拒：通话里直接收掉整通（reason=error），没有通话才只回滚那一条**（静默失败审计 §A）。

      原先这张表不认 `room.publish`，那条轨道永远停在 `publishing`：publish.ok 不来 →
      pub offer 永不产出 → 上行从未协商。界面显示已接通、计时器在走、按钮显示没静音，
      **对方全程听不见看不见，零提示**。留在通话里只报错也不够——Kit 并不展示这类错误，
      而服务端会拒的几种情形（房间已不在、同一路重复发布、请求超时）重试都救不回来。
      收场走 forceEnd：挂断帧不排队、callEnd 只抛一次，各端 Kit 本来就认它。
    */
    if (type === 'room.publish') {
      if (this.ctx.call.state !== 'idle') {
        logger.warn('发布被拒，结束本端通话', { [LogField.callId]: this.ctx.call.callId });
        this.forceEnd(Date.now(), CallEndReason.error);
        return;
      }
      await this.dispatch({ kind: 'internal', name: 'publish_failed', args: { cid: frame.data['cid'] } });
      return;
    }
    // 订阅被拒只摘记账，不收场：最常见的 1301 是订阅与对方停推赛跑输了，通话本身没事。
    if (type === 'room.subscribe') {
      await this.dispatch({
        kind: 'internal',
        name: 'subscribe_failed',
        args: { track_id: frame.data['track_id'] },
      });
    }
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
  private logLocalReject(input: MachineInput, emit: readonly EmittedEvent[]): void {
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
}

/**
 * noteSlowRequest 记下「这一帧从交给 sender 到拿回应答」慢得不正常的那几次。
 *
 * 2026-09-13 iOS frank 的 room.join 从状态机产出到服务端收到隔了 28.6 秒，而客户端一个字都没留下。
 * 有了这一条，拿 `elapsed_ms` 对服务端的受理时刻，就分得清慢在本端发出之前还是服务端那边。
 */
function noteSlowRequest(type: string, startedMs: number, failed: boolean): void {
  const elapsedMs = Date.now() - startedMs;
  if (elapsedMs < SLOW_REQUEST_MS) return;
  logger.warn('请求往返慢', { type, elapsed_ms: elapsedMs, failed });
}

/**
 * videoTurnedOn 挑出这一批事件里「开了摄像头」的人。只看视频、只看开——
 * 关摄像头与麦克风开关不用等画面（Android `videoTurnedOn` 同一条判据）。
 */
export function videoTurnedOn(emit: readonly EmittedEvent[]): string[] {
  const uids: string[] = [];
  for (const event of emit) {
    if (event.cb !== 'onUserVideoAvailable' || event.args['available'] !== true) continue;
    const uid = event.args['uid'];
    if (typeof uid === 'string' && uid !== '') uids.push(uid);
  }
  return uids;
}
