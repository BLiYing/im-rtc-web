import type { EngineBus } from './engineBus.js';
import { ErrorCode } from './errors.js';
import { logger } from './logger.js';
import type { MediaAdapter } from './media/mediaAdapter.js';
import type { MediaBridge } from './media/mediaBridge.js';
import type { MediaPlaneDeps } from './media/mediaPlane.js';
import { addRemoteCandidate } from './media/mediaPlane.js';
import type { Connection } from './signaling/connection.js';
import type { FrameSender } from './signaling/frameSender.js';
import type { EngineContext } from './state/engineMachine.js';
import { initialEngineContext, reduceEngine } from './state/engineMachine.js';
import type { EmittedEvent, MachineInput, OutgoingFrame } from './state/types.js';

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
    const { bus, bridge } = this.deps;
    const result = reduceEngine(this.ctx, input);
    this.ctx = result.state;

    bridge.claim(this.ctx.room.remoteTracks);
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
      bus.emitMachine(event);
    }
    for (const frame of result.send) {
      await this.sendFrame(frame);
    }
  }

  /** sendFrame 发一帧，并把应答喂回状态机。 */
  private async sendFrame(frame: OutgoingFrame): Promise<void> {
    const connection = this.deps.connection();
    if (connection === null) return;
    try {
      const reply = await this.deps.sender.send(connection, frame.type, frame.data);
      // **应答也要喂回状态机**：join.ok / publish.ok 都是状态推进的关键一步。
      if (reply !== null) await this.handleIncoming(reply.type, reply.data);
    } catch (err) {
      // 请求失败不该中断整个事件流：转成 error 事件交给宿主。
      this.deps.bus.emitError(err);
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
