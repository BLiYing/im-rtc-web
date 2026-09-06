import type { ReactNode } from 'react';

import { ControlButton } from './ControlButton.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';
import { callMotion } from '../theme.js';

/**
 * ControlBar 是通话中的控制条。
 *
 * 两到三个按钮：麦克风、（视频通话才有）摄像头、红按钮。**屏幕共享 MVP 不做**
 * （CONVENTIONS §11），所以这里干脆没有那个按钮——留一个灰的比不留更烦人。
 *
 * **没有扬声器按钮**：那是 iOS / Android 才有的东西（听筒 / 外放路由），
 * 浏览器没有对应的 API，放一个点了没反应的按钮更糟。
 *
 * **也没有「小窗」按钮**：收进小窗的唯一入口是标题栏左上角那一颗（`CallHeader`）——
 * 那个位置在三端都是「离开这一屏」的手势位，两个地方各放一颗只会让人犹豫点哪个。
 *
 * **红按钮的语义按房间类型分叉**（规范 §05）：1v1 → `hangup`，群 / 会议 → `leaveRoom`。
 * 文案也跟着变：1v1 写「挂断」，群通话写「离开」。分辨这件事在 `actions.end` 里。
 */
export interface ControlBarProps {
  /** 视频通话里控制条浮在画面上，底下垫渐变、还会自动隐藏。 */
  readonly onVideo?: boolean;
  readonly visible?: boolean;
}

/**
 * showsCameraButton 决定通话中给不给「摄像头」按钮。
 *
 * **只看 media_type，不看本端摄像头开没开。** 语音通话里不给这个按钮：协议上没有
 * 「转视频」这回事（拍板 §11-10）。视频通话里把摄像头关掉之后按钮仍然要有——
 * 对方本来就知道这是视频通话。会议房的 `mediaType` 恒为 `video`，所以它天然留着按钮。
 * 与 iOS 的 `imShowsCameraButton(for:)` 是同一条判据。
 */
export function showsCameraButton(mediaType: string): boolean {
  return mediaType === 'video';
}

export function ControlBar({ onVideo = false, visible = true }: ControlBarProps): ReactNode {
  const { state, actions } = useCall();
  const isLeave = state.isGroup || state.isMeeting;

  return (
    <div
      style={{
        ...styles.controls,
        ...(onVideo ? styles.controlsOnVideo : {}),
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: `opacity ${callMotion.fadeMs}ms ease`,
      }}
      data-testid="control-bar"
      data-visible={visible}
    >
      <ControlButton
        icon="mic"
        caption="静音"
        onIcon="mic-slash"
        onCaption="已静音"
        isOn={!state.self.micOn}
        onClick={() => void actions.toggleMic()}
        testId="toggle-mic"
      />

      {showsCameraButton(state.mediaType) && (
        <ControlButton
          icon="video-slash"
          caption={state.self.cameraBlocked ? '无权限' : '开摄像头'}
          onIcon="video"
          onCaption="关摄像头"
          isOn={state.self.cameraOn}
          disabled={state.self.cameraBlocked}
          onClick={() => void actions.toggleCamera()}
          testId="toggle-camera"
        />
      )}

      <ControlButton
        role="danger"
        icon="phone-down"
        caption={isLeave ? '离开' : state.phase === 'outgoing' ? '取消' : '挂断'}
        onClick={() => void actions.end()}
        testId="end-call"
      />
    </div>
  );
}
