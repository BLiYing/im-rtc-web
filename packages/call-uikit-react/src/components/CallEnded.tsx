import type { ReactNode } from 'react';

import { endReasonText } from '../format/endReason.js';
import type { CallViewState } from '../state/viewTypes.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';
import { t } from '../i18n/index.js';

/**
 * 结束画面：**只说一句为什么，别的什么都没有。**
 *
 * 不带标题：以前这里放 `peerUid`，是没经过名字解析的裸 uid；iOS / Android 的结束画面本来就只有原因一句，
 * 四端对齐（2026-09-20 联测反馈）。
 *
 * # 为什么不复用 ActiveCall
 *
 * 结束态原先直接走 `ActiveCall`，于是屏幕上会出现「静音 / 关摄像头 / 小窗 / 挂断」
 * 这一排**接通后才该有的按钮**，还有九宫格和本端预览。
 * 被叫那边看上去就是「来电页忽然变成了通话页」，停一两秒才消失。
 * 实测反馈：「为何还弹出一个那个接通才有的界面」。
 *
 * （还在响铃的来电根本不会到这里——那一侧直接回 idle，见 `callView.ts` 的 `callEnd`。）
 */
export function CallEnded(): ReactNode {
  const { state } = useCall();
  const text = endedText(state);

  return (
    <div style={styles.overlay} data-testid="call-ended">
      <div style={styles.endedBox}>
        <div style={styles.endedReason}>{text}</div>
      </div>
    </div>
  );
}

/**
 * endedText 决定结束画面那一句话。**优先级固定，缺一不可**：
 * - `joinDeniedText` 优先：`joinCall()` 被拒时这里显示的是错误码文案，不是通用的 `endReasonText`
 *   （HOST_INTEGRATION_DESIGN §3.4，走的还是同一个 callEnd 出口，只是这一句话被换掉了）。
 * - `endHint` 其次：初始 `call()` 被 1409 拒时的专属文案，同一个道理——见 `callView.ts` 的
 *   `inviteRejectedByHost`。两者互斥（一个来自 joinCall，一个来自 call()），不会同时非空。
 * - 会议房没有 `endReason` 那一整套原因码，固定一句「已离开会议」。
 * - 其余情形才轮到通用的 `endReasonText`。时长用服务端给的那个（不变量 I8：四端禁止自己算，时钟对不齐）。
 */
function endedText(state: CallViewState): string {
  if (state.joinDeniedText !== '') return state.joinDeniedText;
  if (state.endHint !== '') return state.endHint;
  if (state.isMeeting) return t('end.meetingLeft');
  return endReasonText(state.endReason, state.role, state.endedDurationSec);
}
