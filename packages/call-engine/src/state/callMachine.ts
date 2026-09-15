import { ErrorCode, errorName } from '../errors.js';
import { CallEndReason } from '../reasons.js';
import type { MediaType } from '../signaling/enums.js';
import { FrameType } from '../signaling/registry.js';
import type { EmittedEvent, MachineInput, MachineOutput, OutgoingFrame } from './types.js';
import { reduceRecv } from './callRecv.js';
import { bool, num, str, strArray } from './types.js';

/**
 * 通话状态机：RTC_PROTOCOL.md §5.1 的 TS 实现。
 *
 * 一致性向量：`im-rtc-server/docs/conformance/call_fsm.json`，四端跑同一份。
 *
 * # 三条容易写错的地方
 *
 * 1. **没有 `ended` 状态**——`ended` 是事件不是状态。草图 §09 里那个「停 1.5s」的
 *    方框是 uikit 的展示状态，由 uikit 自己持有（不变量 I5）。
 * 2. **便利事件只在 1v1 抛**（`onCallCancelled/Rejected/Busy/NoAnswer`）。群通话里
 *    某人拒接只抛 `onUserReject`——否则会违反「便利事件后必定跟 onCallEnd」（I7）。
 * 3. **状态只由信令帧与宿主调用驱动，禁止由定时器改状态**（I4）。
 *    本地振铃倒计时只改 UI，超时由服务端裁决。
 */

/** CallState 是通话状态。**没有 ended**，见文件头。 */
export type CallState = 'idle' | 'inviting' | 'ringing' | 'accepting' | 'connecting' | 'connected';

/** CallRole 是本端在这通电话里的角色。 */
export type CallRole = 'caller' | 'callee' | '';

/** CallContext 是状态机持有的全部数据。 */
export interface CallContext {
  readonly state: CallState;
  readonly callId: string;
  readonly roomId: string;
  readonly roomToken: string;
  readonly mediaType: MediaType;
  readonly isGroup: boolean;
  readonly role: CallRole;
  /** 通话时长的起点，来自服务端。**客户端不自己算时长**（I8）。 */
  readonly connectedAtMs: number;
  /**
   * 拨出中**还没拿到 call_id** 就按了取消：先记下，`call.invite.ok` 一到就补发 `call.cancel`（见 callRecv.ts）。
   *
   * 不这样的话那一帧带着空 call_id 上线路，服务端回 1401，宿主平白多收一条 error
   * （2026-09-15 10:09 demo-react 真机）。与 iOS `IMCallContext.cancelPending` 同形。
   */
  readonly cancelPending: boolean;
  /**
   * 本通电话记下的群号 / user_data——主叫来自 `call()` 的选项，被叫来自 `call.incoming`。
   *
   * **只当 `call.connected` 的兜底用**（HOST_INTEGRATION_DESIGN §3.3）：`onCallBegin` 优先取
   * `call.connected` 里的值，为空才回落到这里，兼容尚未升级的旧服务端。
   */
  readonly chatGroupId: string;
  readonly userData: string;
}

/** initialCallContext 是 idle 态的初值。 */
export const initialCallContext: CallContext = {
  state: 'idle',
  callId: '',
  roomId: '',
  roomToken: '',
  mediaType: 'audio',
  isGroup: false,
  role: '',
  connectedAtMs: 0,
  cancelPending: false,
  chatGroupId: '',
  userData: '',
};


/** out 构造一次状态转移的产物。callRecv.ts 也用它。 */
export function out(
  state: CallContext,
  send: OutgoingFrame[] = [],
  emit: EmittedEvent[] = [],
): MachineOutput<CallContext> {
  return { state, send, emit };
}

/** reduceCall 是通话状态机的唯一入口。 */
export function reduceCall(ctx: CallContext, input: MachineInput): MachineOutput<CallContext> {
  switch (input.kind) {
    case 'act':
      return reduceAct(ctx, input.op, input.args ?? {});
    case 'recv':
      return reduceRecv(ctx, input.type, input.data);
    case 'internal':
      return reduceInternal(ctx, input.name);
  }
}

function reduceInternal(ctx: CallContext, name: string): MachineOutput<CallContext> {
  // 媒体就绪：room.join.ok 到手 + sub PC 的 ICE 连通（§5.1）。
  if (name === 'media_ready' && ctx.state === 'connecting') {
    return out({ ...ctx, state: 'connected' });
  }
  /*
    **`call.invite` 被服务端拒了要回 idle**，与 `join_failed` 同一个道理。

    不退的话通话机永远停在 `inviting`：界面上是「正在呼叫…」转个不停，
    而那通电话服务端根本没建；随后每一次挂断都发向一个不存在的 call，
    换回 `1401 call_not_found`，**永远退不出去**。
    （实测：群呼把主叫自己也放进了 callee_ids，服务端回 1004，
    然后连点五次挂断全是 1401。）

    抛 `onCallEnd` 而不是只清状态：它是所有结束分支的唯一出口（设计 §7.5），
    界面只认这一个信号来收场子。reason 用 `error`——这通电话从未建立，
    hangup/cancel/reject 哪个都不是实情。
  */
  if (name === 'call_failed' && ctx.state !== 'idle') {
    return out(initialCallContext, [], [{
      cb: 'onCallEnd',
      args: {
        call_id: ctx.callId,
        reason: CallEndReason.error,
        duration_sec: 0,
        ended_by: '',
      },
    }]);
  }
  return out(ctx);
}

function reduceAct(
  ctx: CallContext,
  op: string,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<CallContext> {
  switch (op) {
    case 'call':
      return startCall(ctx, args);
    case 'accept':
      return acceptCall(ctx);
    case 'reject':
      // reject 只发帧，状态由随后的 call.ended 推进——服务端才是裁决方。
      return ctx.state === 'ringing'
        ? out(ctx, [{ type: FrameType.callReject, data: { call_id: ctx.callId } }])
        : invalidState(ctx);
    case 'cancel':
      if (ctx.state !== 'inviting') return invalidState(ctx);
      // 还没拿到 call_id（invite.ok 在路上）：这一帧发出去只会换回 1401。先挂起，invite.ok 一到就补发（callRecv.ts）。
      if (ctx.callId === '') return out({ ...ctx, cancelPending: true });
      return out(ctx, [{ type: FrameType.callCancel, data: { call_id: ctx.callId } }]);
    case 'hangup':
      return ctx.state === 'connected' || ctx.state === 'connecting'
        ? out(ctx, [{ type: FrameType.callHangup, data: { call_id: ctx.callId } }])
        : invalidState(ctx);
    case 'invite_more':
      return inviteMore(ctx, args);
    case 'join_call':
      return joinOngoingCall(ctx, args);
    default:
      return invalidState(ctx);
  }
}

function startCall(
  ctx: CallContext,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<CallContext> {
  if (ctx.state !== 'idle') return invalidState(ctx);

  const calleeIds = strArray(args, 'callee_ids');
  const mediaType = str(args, 'media_type') === 'video' ? 'video' : 'audio';
  const isGroup = bool(args, 'is_group');
  const chatGroupId = str(args, 'chat_group_id');
  const userData = str(args, 'user_data');

  /*
    **省略 = 协议默认值**（newFrameData 的规矩，见 registry.ts）：只在宿主真的给了值时才
    把键放进去，交给 frameSender → encodeFields 那一层去填协议默认值。显式写空串/0 会把
    「没传」和「传了空/0」混为一谈——`timeout_sec` 尤其致命：写 0 会被 §2.6 的钳制夹到
    下限 5s，而不是协议默认的 30s。
  */
  const data: Record<string, unknown> = { callee_ids: calleeIds, media_type: mediaType, is_group: isGroup };
  if (chatGroupId !== '') data['chat_group_id'] = chatGroupId;
  if (userData !== '') data['user_data'] = userData;
  if (Object.hasOwn(args, 'timeout_sec')) data['timeout_sec'] = num(args, 'timeout_sec');

  return out(
    { ...ctx, state: 'inviting', role: 'caller', mediaType, isGroup, chatGroupId, userData },
    [{ type: FrameType.callInvite, data }],
  );
}

function acceptCall(ctx: CallContext): MachineOutput<CallContext> {
  // 第二次 accept 必须**本地**拦下，不能发上去让服务端回 1405（不变量 R1 的同款理由）。
  if (ctx.state !== 'ringing') return invalidState(ctx);
  return out({ ...ctx, state: 'accepting' }, [
    { type: FrameType.callAccept, data: { call_id: ctx.callId } },
  ]);
}

function inviteMore(
  ctx: CallContext,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<CallContext> {
  if (ctx.state !== 'connected' && ctx.state !== 'connecting') return invalidState(ctx);
  return out(ctx, [
    {
      type: FrameType.callInviteMore,
      data: { call_id: ctx.callId, callee_ids: strArray(args, 'callee_ids') },
    },
  ]);
}

/**
 * joinOngoingCall 是「群成员看到『进行中』主动加入」（§4.1）。
 *
 * **「怎么知道有通话在进行中」不在本协议里**——那是宿主拿 webhook `call.started`
 * 自己发广播的事。engine 只负责把 call_id 送上去。
 */
function joinOngoingCall(
  ctx: CallContext,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<CallContext> {
  if (ctx.state !== 'idle') return invalidState(ctx);
  const callId = str(args, 'call_id');
  return out({ ...ctx, state: 'accepting', role: 'callee', callId, isGroup: true }, [
    { type: FrameType.callJoin, data: { call_id: callId } },
  ]);
}

function invalidState(ctx: CallContext): MachineOutput<CallContext> {
  return out(ctx, [], [
    {
      cb: 'onError',
      args: { code: ErrorCode.invalidState, name: errorName(ErrorCode.invalidState) },
    },
  ]);
}

/** synthesizeNetworkEnd 是不变量 I8 的那个**唯一例外**。 */
export function synthesizeNetworkEnd(ctx: CallContext, nowMs: number): MachineOutput<CallContext> {
  if (ctx.state === 'idle') return out(ctx);
  const durationSec =
    ctx.connectedAtMs > 0 ? Math.max(0, Math.floor((nowMs - ctx.connectedAtMs) / 1000)) : 0;
  return out({ ...initialCallContext }, [], [
    {
      cb: 'onCallEnd',
      args: {
        call_id: ctx.callId,
        reason: CallEndReason.network,
        duration_sec: durationSec,
        ended_by: '',
      },
    },
  ]);
}
