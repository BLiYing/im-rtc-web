import { normalizeReason } from '../reasons.js';
import { FrameType } from '../signaling/registry.js';
import type { CallContext } from './callMachine.js';
import { initialCallContext, out } from './callMachine.js';
import type { EmittedEvent, MachineOutput } from './types.js';
import { bool, num, str, strArray } from './types.js';

/**
 * 通话状态机的**下行帧**分支（RTC_PROTOCOL.md §5.1 的转移表右半边）。
 *
 * 与 callMachine.ts 拆开是因为体量红线（CONVENTIONS §2，400 行）——
 * 「上行动作」与「下行帧」本来也是两组独立的关注点。
 */

/** CALL_INVITE_OK 是 call.invite 的应答类型。 */
const CALL_INVITE_OK = `${FrameType.callInvite}.ok`;

/**
 * reduceRecv 处理一条下行帧。
 *
 * 两条优先级规则写在最前面，别挪：
 * 1. **终态帧优先**——任何非 idle 状态收到 call.ended 都直达 idle（§5.1）。
 * 2. **idle 下的迟到帧一律静默丢弃**：不抛回调、不发帧、不报错。
 *    本地状态与服务端赛跑是正常的，客户端得容忍。
 */
export function reduceRecv(
  ctx: CallContext,
  type: string,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<CallContext> {
  // **别的一通电话的帧一律不许碰当前这一通**（见 handleForeignCall）。
  if (isForAnotherCall(ctx, data)) return handleForeignCall(ctx, type, data);

  // 终态帧优先：**任何非 idle 状态收到 call.ended 都直达 idle**（§5.1）。
  if (type === FrameType.callEnded) return handleEnded(ctx, data);

  // idle 下的迟到帧一律静默丢弃：不抛回调、不发帧、不报错。
  if (ctx.state === 'idle' && type !== FrameType.callIncoming) return out(ctx);

  switch (type) {
    case FrameType.callIncoming:
      return handleIncoming(ctx, data);
    case CALL_INVITE_OK:
      return out({ ...ctx, callId: str(data, 'call_id'), roomId: str(data, 'room_id') });
    case FrameType.callConnected:
      return handleConnected(ctx, data);
    case FrameType.callAccepted:
      return out(ctx, [], [{ cb: 'onUserAccept', args: { uid: str(data, 'uid') } }]);
    case FrameType.callRejected:
      return handleOutcome(ctx, data, 'onUserReject', 'onCallRejected');
    case FrameType.callNoAnswer:
      return handleOutcome(ctx, data, 'onUserNoResponse', 'onCallNoAnswer');
    case FrameType.callBusy:
      // 忙线没有对应的 onUser* —— 被叫压根没振铃（§4.3）。
      return ctx.isGroup
        ? out(ctx)
        : out(ctx, [], [{ cb: 'onCallBusy', args: { uid: str(data, 'uid') } }]);
    case FrameType.callCancelled:
      return out(ctx, [], [{ cb: 'onCallCancelled', args: { by: str(data, 'by') } }]);
    case FrameType.callHandledElsewhere:
      return out(ctx, [], [
        {
          cb: 'onHandledOnOtherDevice',
          args: { call_id: str(data, 'call_id'), action: str(data, 'action') },
        },
      ]);
    default:
      // 其余（call.ringing、各种 .ok）不改状态也不抛回调。
      return out(ctx);
  }
}

/**
 * 这一帧说的是不是**别的一通电话**。
 *
 * 通话中被第三个人呼叫时，服务端判他忙线并给我们发一条 `call.ended{busy}`——
 * 那条帧的 `call_id` 是**新来那通**的。原先这里不看 call_id，于是它被当成
 * 「当前通话结束了」：媒体面直接关掉、通话页收起，而对面还好好地显示着通话中
 * （真机日志 08:30:39，iOS 侧一串 `PC 状态 closed` 紧跟一条别的 call_id 的 callEnd）。
 */
function isForAnotherCall(ctx: CallContext, data: Readonly<Record<string, unknown>>): boolean {
  const frameCallId = str(data, 'call_id');
  return ctx.callId !== '' && frameCallId !== '' && frameCallId !== ctx.callId;
}

/**
 * 别的一通电话的帧：**一律不碰当前状态**。
 *
 * 只有终态帧要露个头——那说明「有人打进来，已经被自动回了忙线」，
 * 界面据此提示一句谁来过电话（交互规则见 UX_FLOWS §06）。
 */
function handleForeignCall(
  ctx: CallContext,
  type: string,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<CallContext> {
  if (type !== FrameType.callEnded) return out(ctx);
  return out(ctx, [], [
    {
      cb: 'onCallMissed',
      // 状态机的 args 一律 snake_case（与向量、与另外三端同名）；
      // 出到公开事件时由 engineBus 的 camelizeArgs 统一转。
      args: {
        call_id: str(data, 'call_id'),
        caller: str(data, 'caller'),
        reason: str(data, 'reason'),
      },
    },
  ]);
}

function handleIncoming(
  ctx: CallContext,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<CallContext> {
  if (ctx.state !== 'idle') return out(ctx);
  const mediaType = str(data, 'media_type') === 'video' ? 'video' : 'audio';
  const next: CallContext = {
    ...ctx,
    state: 'ringing',
    role: 'callee',
    callId: str(data, 'call_id'),
    roomId: str(data, 'room_id'),
    mediaType,
    isGroup: bool(data, 'is_group'),
  };
  return out(next, [], [
    {
      cb: 'onCallReceived',
      args: {
        call_id: next.callId,
        caller: str(data, 'caller'),
        // **原样带上**：群通话里被叫要靠它摆占位格（见 events.ts 的字段注释）。
        callee_ids: strArray(data, 'callee_ids'),
        media_type: mediaType,
        is_group: next.isGroup,
      },
    },
  ]);
}

/**
 * handleConnected：拿到 room_token，抛 onCallBegin，并**立刻发 room.join**。
 *
 * onCallBegin 抛在进入 connecting 时（不是 connected）——草图 §09 的时序就是这样：
 * 双方在 room_ready（现名 call.connected）那一刻同时开始计时。
 */
function handleConnected(
  ctx: CallContext,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<CallContext> {
  if (ctx.state !== 'inviting' && ctx.state !== 'ringing' && ctx.state !== 'accepting') {
    return out(ctx);
  }
  const roomId = str(data, 'room_id');
  const roomToken = str(data, 'room_token');
  const mediaType = str(data, 'media_type') === 'video' ? 'video' : ctx.mediaType;
  const next: CallContext = {
    ...ctx,
    state: 'connecting',
    callId: str(data, 'call_id') || ctx.callId,
    roomId,
    roomToken,
    mediaType,
    isGroup: bool(data, 'is_group') || ctx.isGroup,
    connectedAtMs: num(data, 'connected_at_ms'),
  };
  return out(
    next,
    [{ type: FrameType.roomJoin, data: { room_id: roomId, room_token: roomToken } }],
    [
      {
        cb: 'onCallBegin',
        args: {
          call_id: next.callId,
          room_id: roomId,
          media_type: mediaType,
          is_group: next.isGroup,
          role: next.role,
        },
      },
    ],
  );
}

/**
 * handleOutcome 处理某成员的裁决。
 *
 * **便利事件只在 1v1 抛**（不变量 I7）：群里一个人拒接，通话还在继续，
 * 后面并不会紧跟 onCallEnd，抛便利事件就自相矛盾了。
 */
function handleOutcome(
  ctx: CallContext,
  data: Readonly<Record<string, unknown>>,
  userCb: string,
  convenienceCb: string,
): MachineOutput<CallContext> {
  const uid = str(data, 'uid');
  const emit: EmittedEvent[] = [{ cb: userCb, args: { uid } }];
  if (!ctx.isGroup) emit.push({ cb: convenienceCb, args: { uid } });
  return out(ctx, [], emit);
}

/**
 * handleEnded：唯一的终态处理。
 *
 * **收到 call.ended 后禁止再发 room.leave**（不变量 I6）——服务端在结束通话时
 * 已经清掉了房间成员，再发只会换回 1201/1203。
 */
function handleEnded(
  ctx: CallContext,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<CallContext> {
  if (ctx.state === 'idle') return out(ctx);
  return out({ ...initialCallContext }, [], [
    {
      cb: 'onCallEnd',
      args: {
        call_id: str(data, 'call_id'),
        reason: normalizeReason(data['reason']),
        duration_sec: num(data, 'duration_sec'),
        ended_by: str(data, 'ended_by'),
      },
    },
  ]);
}
