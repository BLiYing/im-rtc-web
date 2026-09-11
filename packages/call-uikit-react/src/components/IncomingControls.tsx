import type { MediaType } from '@im-rtc/call-engine';
import type { ReactNode } from 'react';

import { useCall } from '../useCall.js';
import { styles } from '../styles.js';
import { showsCameraButton } from './ControlBar.js';
import { ControlButton } from './ControlButton.js';

/**
 * IncomingControls 是来电页底部那一排（草图 §03-F）：摄像头（仅视频）/ 拒绝 / 接听，三格等宽。
 *
 * **接听键恒为话筒 📞**，视频来电也是——与横幅上那颗一致（草图 §04-I，2026-09-11 订正）。
 * 摄像头开关的语义同横幅（拍板 §11-10）：关掉再接听 = 只要麦克风。
 * 与 iOS `renderControls` 的 incoming 分支是同一组按钮。
 */
export function IncomingControls(): ReactNode {
  const { state, actions } = useCall();
  return (
    <div style={styles.controls} data-testid="incoming-controls">
      {showsCameraButton(state.mediaType) && (
        <ControlButton
          icon="video-slash"
          caption={state.self.cameraBlocked ? '无权限' : '开摄像头'}
          onIcon="video"
          onCaption="关摄像头"
          isOn={state.self.cameraOn}
          disabled={state.self.cameraBlocked}
          onClick={() => void actions.toggleCamera()}
          testId="incoming-toggle-camera"
        />
      )}
      <ControlButton role="danger" icon="xmark" caption="拒绝" onClick={() => void actions.reject()} testId="reject-call" />
      <ControlButton role="accept" icon="phone" caption="接听" onClick={() => void actions.accept()} testId="accept-call" />
    </div>
  );
}

/** incomingInviteText 是来电那一句「邀请你…」。横幅与来电页共用，两处不该各写一份。 */
export function incomingInviteText(mediaType: MediaType, isGroup: boolean): string {
  if (isGroup) return '邀请你加入群通话';
  return `邀请你${mediaType === 'video' ? '视频' : '语音'}通话`;
}
