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

  // idle 下的迟到帧一律静默丢弃：不抛回调、不报错。只有两条例外要补发结束帧，见 handleLateFrame。
  if (ctx.state === 'idle' && type !== FrameType.callIncoming) return handleLateFrame(ctx, type, data);

  switch (type) {
    case FrameType.callIncoming:
      return handleIncoming(ctx, data);
    case CALL_INVITE_OK:
      return handleInviteOk(ctx, data);
    case FrameType.callConnected:
      return handleConnected(ctx, data);
    case FrameType.callRinging:
      // 服务端发给通话里的所有人（协议 §4.2，2026-09-17 起），界面据此给正在响铃的人摆占位格。
      return out(ctx, [], [{ cb: 'onUserRinging', args: { uid: str(data, 'uid') } }]);
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
      // 内部回调参数按一致性向量钉的线路字段名 by（四端共用，见 call_fsm.json）；
      // 公开事件字段改叫 uid 是 engineBus.ts 的 emitMachine 在进公开事件表那一步做的翻译。
      return out(ctx, [], [{ cb: 'onCallCancelled', args: { by: str(data, 'by') } }]);
    case FrameType.callHandledElsewhere:
      return out(ctx, [], [
        {
          cb: 'onHandledOnOtherDevice',
          args: { call_id: str(data, 'call_id'), action: str(data, 'action') },
        },
      ]);
    default:
      // 其余（各种 .ok）不改状态也不抛回调。
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

/**
 * handleLateFrame：idle 下迟到的帧**照旧丢弃**（优先级规则 2），只有两条例外——
 * 它们说明服务端那边**还有一通挂着本端的电话**，而本地早就收场了
 * （红键强制收场时请求还在路上，或请求超时回滚之后应答才到）：
 *
 * - `call.invite.ok`：邀请在服务端落地了，被叫正在响铃。补发 `call.cancel`，
 *   否则被叫一直响到超时，而主叫这边一个界面都没有。
 * - `call.connected`：有人已经接起来了（cancel 来不及，或本端是被叫、accept 已落地）。
 *   补发 `call.hangup`，否则服务端一直把本端当成在通话里。
 *
 * 本地状态不动、不抛回调。补发的帧被拒（比如通话已经结束）只换回一条 error 事件，无害。
 * 与 iOS `IMCallMachine.handleLateFrame` 同形。
 */
function handleLateFrame(
  ctx: CallContext,
  type: string,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<CallContext> {
  const callId = str(data, 'call_id');
  if (callId === '') return out(ctx);
  if (type === CALL_INVITE_OK) {
    return out(ctx, [{ type: FrameType.callCancel, data: { call_id: callId } }]);
  }
  if (type === FrameType.callConnected) {
    return out(ctx, [{ type: FrameType.callHangup, data: { call_id: callId } }]);
  }
  return out(ctx);
}

/**
 * handleInviteOk：记下 call_id / room_id。
 *
 * **invite.ok 回来之前按过取消**（callMachine 的 `cancel`，那时没有 call_id 可发）：
 * 现在有了，立刻补发 `call.cancel`——不必等 uikit 的看门狗。与 iOS `IMCallMachine.reduceRecv` 同形。
 */
function handleInviteOk(
  ctx: CallContext,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<CallContext> {
  const next: CallContext = { ...ctx, callId: str(data, 'call_id'), roomId: str(data, 'room_id') };
  if (!ctx.cancelPending || next.callId === '') return out(next);
  return out({ ...next, cancelPending: false }, [
    { type: FrameType.callCancel, data: { call_id: next.callId } },
  ]);
}

function handleIncoming(
  ctx: CallContext,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<CallContext> {
  if (ctx.state !== 'idle') return out(ctx);
  const mediaType = str(data, 'media_type') === 'video' ? 'video' : 'audio';
  const caller = str(data, 'caller');
  // inviter 是「谁把你拉进来的」（invite_more 时不是发起人）；旧服务端不带它，回落 caller。
  const inviter = str(data, 'inviter') || caller;
  const next: CallContext = {
    ...ctx,
    state: 'ringing',
    role: 'callee',
    callId: str(data, 'call_id'),
    roomId: str(data, 'room_id'),
    mediaType,
    isGroup: bool(data, 'is_group'),
    // 记下来给 onCallBegin 兜底用（HOST_INTEGRATION_DESIGN §3.3）：接通时优先用
    // call.connected 自己带的值，这里存的是万一它为空时的回落。
    chatGroupId: str(data, 'chat_group_id'),
    userData: str(data, 'user_data'),
  };
  return out(next, [], [
    {
      cb: 'onCallReceived',
      args: {
        call_id: next.callId,
        caller,
        inviter,
        // **原样带上**：群通话里被叫要靠它摆占位格（见 events.ts 的字段注释）。
        callee_ids: strArray(data, 'callee_ids'),
        // 此刻已在通话里的人；旧服务端不带 = 空，界面回落成「只有 caller 在通话里」。
        joined_ids: strArray(data, 'joined_ids'),
        media_type: mediaType,
        is_group: next.isGroup,
        chat_group_id: next.chatGroupId,
        user_data: next.userData,
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
  // 群号 / user_data：优先取 call.connected 自己带的值，为空才回落到本通 call.incoming /
  // call() 选项里记下的那份（兼容还没升级的旧服务端，HOST_INTEGRATION_DESIGN §3.3）。
  const chatGroupId = str(data, 'chat_group_id') || ctx.chatGroupId;
  const userData = str(data, 'user_data') || ctx.userData;
  const next: CallContext = {
    ...ctx,
    state: 'connecting',
    callId: str(data, 'call_id') || ctx.callId,
    roomId,
    roomToken,
    mediaType,
    isGroup: bool(data, 'is_group') || ctx.isGroup,
    connectedAtMs: num(data, 'connected_at_ms'),
    chatGroupId,
    userData,
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
          // call.join 进来的人没收过 call.incoming，caller 只能从这里知道是谁打的（协议 §4.2）。
          caller: str(data, 'caller'),
          chat_group_id: chatGroupId,
          user_data: userData,
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
