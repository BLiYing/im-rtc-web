import type { ReactNode } from 'react';

import { ControlButton } from './ControlButton.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';

/**
 * ControlBar 是通话中的控制条。
 *
 * 四个按钮：麦克风、摄像头、最小化、挂断。**屏幕共享 MVP 不做**
 * （CONVENTIONS §11），所以这里干脆没有那个按钮——留一个灰的比不留更烦人。
 *
 * **没有扬声器按钮**：那是 iOS 才有的东西（`AVAudioSession` 的听筒/外放路由），
 * 浏览器没有对应的 API，放一个点了没反应的按钮更糟。
 */
export function ControlBar(): ReactNode {
  const { state, actions } = useCall();
  const isVideo = state.mediaType === 'video';

  return (
    <div style={styles.controls}>
      <ControlButton
        icon="mic"
        caption="静音"
        onIcon="mic-slash"
        onCaption="已静音"
        isOn={!state.self.micOn}
        onClick={() => void actions.toggleMic()}
        testId="toggle-mic"
      />

      <ControlButton
        icon="video-slash"
        caption={isVideo ? '开摄像头' : '开视频'}
        onIcon="video"
        onCaption="关摄像头"
        isOn={state.self.cameraOn}
        onClick={() => void actions.toggleCamera()}
        testId="toggle-camera"
      />

      <ControlButton
        icon="minimize"
        caption="小窗"
        onClick={() => actions.setMinimized(true)}
        testId="minimize"
      />

      <ControlButton
        role="danger"
        icon="phone-down"
        caption={state.isMeeting ? '离开' : '挂断'}
        onClick={() => void actions.end()}
        testId="end-call"
      />
    </div>
  );
}
