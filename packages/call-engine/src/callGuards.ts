import { byteLength } from './bytes.js';
import { violatesCallOptionLimits } from './callOptions.js';
import type { EngineBus } from './engineBus.js';
import { ErrorCode, RtcError } from './errors.js';
import { logger } from './logger.js';
import { CallEndReason } from './reasons.js';

/*
  发起类动作（`call` / `inviteMore`）上线路**之前**的本地关卡。

  从 `engine.ts` 里单拎出来：门面只该留公开签名与给宿主看的文档，
  「哪些参数本地先拦、拦了走哪个出口」是一段自成一体的规则，放在门面里只是让那个文件贴着体量红线。
  判断本身是纯函数的那部分在 `callOptions.ts`；这里管的是日志与「拒了之后给界面的出口」。
  拒绝本身**交给调用方**（门面 throw 返回的错误），不发 error 事件——一次失败只从一个出口报
  （server `docs/design/ACTION_RESULT_DESIGN.md` R3）。
*/

/**
 * rejectsSelf 挡住「名单里有自己」：返回要交给调用方的 `1004`，没问题时返回 null。
 *
 * 服务端会以 `1004 bad_params` 拒掉（"callee_ids 不能含主叫自己"），但那条链路上的
 * 失败很难看懂：界面已经乐观地进了「正在呼叫…」，而错误只是一条没头没尾的 1004。
 * （实测撞过：Demo 的群呼默认名单里正好有登录的那个人。）
 *
 * **一份实现供 call 与 inviteMore 共用**——两处各写一遍的话，改了一处忘了另一处，
 * 就又是一个「同一条规则在一处成立、另一处不成立」。
 */
export function rejectsSelf(
  myUid: string,
  calleeIds: readonly string[],
  what: string,
  forType: string,
): RtcError | null {
  if (myUid === '' || !calleeIds.includes(myUid)) return null;
  logger.warn(`${what}名单里含自己，已就地拒掉`, { uid: myUid });
  return new RtcError(ErrorCode.badParams, { forType });
}

/**
 * rejectsBadCallOptions 挡住超限的 `chatGroupId` / `userData`：返回要交给调用方的 `1004`，没问题时返回 null。
 *
 * 服务端会以 `1004 bad_params` 拒掉，但那条链路上主叫已经乐观地进了「正在呼叫…」，
 * 错误只是一条没头没尾的 1004——与 {@link rejectsSelf} 同一个理由，本地先拦，
 * 走同一个出口（HOST_INTEGRATION_DESIGN §3.3）。
 */
export function rejectsBadCallOptions(chatGroupId: string, userData: string): RtcError | null {
  if (!violatesCallOptionLimits(chatGroupId, userData)) return null;
  logger.warn('chatGroupId / userData 超限，已就地拒掉', {
    chatGroupId, userDataBytes: byteLength(userData),
  });
  return new RtcError(ErrorCode.badParams, { forType: 'call.invite' });
}

/**
 * emitLocallyRejectedCall 给「`call()` 被本地拒掉」一个出口：抛一条 `callEnd(error)`。
 *
 * 调用方（uikit / 宿主）在调 `call()` 之前就已经切到「正在呼叫…」了——
 * 这是对的，不然按下去几百毫秒没反应。但只交回一个错误，
 * 靠事件驱动的界面不知道该退回哪儿：实测三人测试里 carol 卡在「正在呼叫…」，
 * 连点五次挂断收到五个 2005（状态机是 idle，没有 call 可挂），
 * 除了刷新页面没有别的出路。
 *
 * `callEnd` 是所有结束分支的唯一出口（设计 §7.5），
 * 这一条与「服务端拒了 invite」（call_failed）走同一个出口，界面只认它。
 */
export function emitLocallyRejectedCall(bus: EngineBus): void {
  bus.emit('callEnd', {
    callId: '',
    reason: CallEndReason.error,
    durationSec: 0,
    endedBy: '',
  });
}
