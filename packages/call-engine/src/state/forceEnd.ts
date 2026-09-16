import { CallEndReason, callDurationSec } from '../reasons.js';
import type { CallEndReasonValue } from '../reasons.js';
import { FrameType } from '../signaling/registry.js';
import type { CallContext } from './callMachine.js';
import { initialCallContext } from './callMachine.js';
import type { EngineContext } from './engineMachine.js';
import { clearedRoom } from './roomMachine.js';
import type { MachineOutput, OutgoingFrame } from './types.js';

/**
 * 强制收场：红键按下去**等不到结束事件**时的出口（门面见 `CallEngine.forceEnd`）。
 *
 * # 为什么 hangup 不够
 *
 * hangup 只发帧，状态由随后的 `call.ended` 推进——服务端才是裁决方（§5.1）。帧要是根本没发出去，
 * 这一场就永远收不掉：2026-09-13 14:54 iOS frank 按了挂断，`call.hangup` 一帧没到服务端，
 * Kit 的看门狗把界面收了，Engine 却还留在通话与房间里，别人一直看得见他，直到 14:58 整通结束。
 *
 * # 这里只算「该发什么、收成什么样」
 *
 * 纯函数，与 `dropLostSession` 同一个形状：通话机、房间机一起归零，抛唯一的结束出口。
 * **发帧由帧循环直接交给信令连接**（不排在在途请求后面），关媒体走既有的 `LEAVE_CALLBACKS`。
 * 五端同形：iOS `IMEngineMachine.forceEnd`、Android 同名。
 */

/**
 * forceEnd 算出强制收场的结果。没有进行中的通话也不在房里时原样返回（`emit` 为空）。
 *
 * 时长与恢复失败时 I8 的那条例外同一个算法：本地已经收场，服务端那条带真值的 `call.ended`
 * 随后会因为 idle 被丢掉，没有更准的值可用。起点优先用**本端**进来那一刻（`callStartedAtMs`），
 * 没记到才退回整通电话的 `connected_at_ms`——中途被拉进来的人用后者会偏大
 * （2026-09-15 10:05 iOS frank 待了约 6 秒，本地写成 124 秒）。
 *
 * `reason` 不给就按此刻状态挑（红键）；给了就用它——`room.publish` 被拒时帧循环传 `error`，
 * 那不是用户挂的，写成 hangup 是撒谎。
 */
export function forceEnd(
  ctx: EngineContext,
  nowMs: number,
  reasonOverride?: CallEndReasonValue,
): MachineOutput<EngineContext> {
  if (ctx.call.state !== 'idle') {
    const { frames, reason: byState } = endFrames(ctx.call);
    const reason = reasonOverride ?? byState;
    const startedAtMs = ctx.callStartedAtMs > 0 ? ctx.callStartedAtMs : ctx.call.connectedAtMs;
    return {
      state: { room: clearedRoom('idle'), call: initialCallContext, callStartedAtMs: 0 },
      send: frames,
      emit: [
        {
          cb: 'onCallEnd',
          args: {
            call_id: ctx.call.callId,
            reason,
            duration_sec: callDurationSec(startedAtMs, nowMs),
            ended_by: '',
          },
        },
      ],
    };
  }
  if (ctx.room.state === 'idle') return { state: ctx, send: [], emit: [] };

  // 没有通话却在房里：会议。结束动作是离房（uikit 的红键在会议里就是 leaveRoom）。
  const send: OutgoingFrame[] =
    ctx.room.roomId === '' ? [] : [{ type: FrameType.roomLeave, data: { room_id: ctx.room.roomId } }];
  return {
    state: { ...ctx, room: clearedRoom('idle') },
    send,
    emit: [{ cb: 'onRoomLeft', args: { room_id: ctx.room.roomId } }],
  };
}

/**
 * endFrames 按通话此刻的状态挑结束帧，以及本地收场写哪个结束原因。
 *
 * - `accepting` 发 **reject + hangup 两帧**：accept 有没有在服务端落地，本端不知道。
 *   还在响铃就是 reject 生效（随后那条 hangup 被拒，无害）；已经接起来就是 hangup 生效。
 * - `inviting` 还没拿到 call_id（`call.invite.ok` 没回来）时**此刻发不了 cancel**，
 *   由那条 invite.ok 迟到时补发（`callRecv.ts` 的 `handleLateFrame`）。
 */
export function endFrames(call: CallContext): {
  readonly frames: OutgoingFrame[];
  readonly reason: CallEndReasonValue;
} {
  let reason: CallEndReasonValue = CallEndReason.hangup;
  let types: string[] = [];
  switch (call.state) {
    case 'idle':
      return { frames: [], reason };
    case 'ringing':
      reason = CallEndReason.reject;
      types = [FrameType.callReject];
      break;
    case 'inviting':
      reason = CallEndReason.cancel;
      types = [FrameType.callCancel];
      break;
    case 'accepting':
      types = [FrameType.callReject, FrameType.callHangup];
      break;
    case 'connecting':
    case 'connected':
      types = [FrameType.callHangup];
      break;
  }
  if (call.callId === '') return { frames: [], reason };
  return { frames: types.map((type) => ({ type, data: { call_id: call.callId } })), reason };
}
