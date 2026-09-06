import type { CallEndReasonValue } from '@im-rtc/call-engine';

import { formatDuration } from './duration.js';

/**
 * 结束原因的人话。**结束画面必须说清为什么**——只写「通话结束」然后一闪而过，
 * 用户根本不知道是对方拒了、忙线、还是压根不在线。
 *
 * reason 的取值见 `docs/conformance/reasons.json`，八种；未知值兜底成「已结束」，
 * **不显示原始英文**——那是给日志看的，不是给用户看的。
 *
 * 与 iOS 的 `imEndReasonText` 是同一张表，文案逐字对齐（四端行为一致）。
 */
export function endReasonText(
  reason: CallEndReasonValue | '',
  role: string,
  durationSec: number,
): string {
  switch (reason) {
    case 'hangup':
      // 接通过才有时长；没接通的 hangup 不该出现，真出现了也别显示 00:00。
      return durationSec > 0 ? `通话结束 · ${formatDuration(durationSec)}` : '通话结束';
    case 'cancel':
      return role === 'caller' ? '已取消' : '对方已取消';
    case 'reject':
      return role === 'caller' ? '对方已拒接' : '已拒接';
    case 'busy':
      return '对方忙线中';
    case 'no_answer':
      return role === 'caller' ? '对方无人接听' : '未接来电';
    case 'offline':
      // 服务端在被叫一台在线设备都没有时立刻结束，**不振铃**（协议 §4.3）——
      // 对着一个不在的人响 30 秒没有意义。但界面必须说清楚。
      return '对方当前不在线';
    case 'network':
      return '网络中断';
    case 'answered_elsewhere':
      return '已在其他设备接听';
    case 'rejected_elsewhere':
      return '已在其他设备拒绝';
    case 'room_closed':
      return '房间已解散';
    case 'kicked':
      return '已被移出';
    default:
      return '已结束';
  }
}

/**
 * 结束画面停留多久（毫秒）。**说不清原因的那几种要停久一点**：
 * 「对方不在线」得让人看清，而正常挂断谁都知道发生了什么。
 *
 * 与 iOS 的 `imEndedHoldSeconds` 同一张表。
 */
export function endedHoldMs(reason: CallEndReasonValue | ''): number {
  return reason === 'hangup' || reason === 'cancel' ? 1500 : 3000;
}
