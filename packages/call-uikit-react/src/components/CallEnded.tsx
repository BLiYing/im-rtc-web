import type { ReactNode } from 'react';

import { endReasonText } from '../format/endReason.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';

/**
 * 结束画面：**只说一句为什么，别的什么都没有。**
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
  const seconds = state.beganAtMs === 0 ? 0 : Math.floor((Date.now() - state.beganAtMs) / 1000);
  const text = state.isMeeting
    ? '已离开会议'
    : endReasonText(state.endReason, state.role, seconds);

  return (
    <div style={styles.overlay} data-testid="call-ended">
      <div style={styles.endedBox}>
        <div style={styles.title}>{state.peerUid || title(state.isGroup, state.isMeeting)}</div>
        <div style={styles.endedReason}>{text}</div>
      </div>
    </div>
  );
}

function title(isGroup: boolean, isMeeting: boolean): string {
  if (isMeeting) return '会议';
  return isGroup ? '群通话' : '通话';
}
