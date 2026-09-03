import type { ReactNode } from 'react';

import { useCall } from '../useCall.js';
import { styles } from '../styles.js';

/**
 * ControlBar 是通话中的控制条。
 *
 * 只有四个按钮：麦克风、摄像头、最小化、挂断。**屏幕共享 MVP 不做**
 * （CONVENTIONS §11），所以这里干脆没有那个按钮——留一个灰的比不留更烦人。
 */
export function ControlBar(): ReactNode {
  const { state, actions } = useCall();
  const isVideo = state.mediaType === 'video';

  return (
    <div style={styles.controls}>
      <button
        type="button"
        style={{ ...styles.button, ...(state.self.micOn ? {} : styles.buttonOff) }}
        onClick={() => void actions.toggleMic()}
        aria-pressed={!state.self.micOn}
        data-testid="toggle-mic"
      >
        {state.self.micOn ? '静音' : '取消静音'}
      </button>

      <button
        type="button"
        style={{ ...styles.button, ...(state.self.cameraOn ? {} : styles.buttonOff) }}
        onClick={() => void actions.toggleCamera()}
        aria-pressed={!state.self.cameraOn}
        data-testid="toggle-camera"
      >
        {state.self.cameraOn ? '关摄像头' : (isVideo ? '开摄像头' : '开视频')}
      </button>

      <button
        type="button"
        style={styles.button}
        onClick={() => actions.setMinimized(true)}
        data-testid="minimize"
      >
        小窗
      </button>

      <button
        type="button"
        style={{ ...styles.button, ...styles.buttonDanger }}
        onClick={() => void actions.end()}
        data-testid="end-call"
      >
        挂断
      </button>
    </div>
  );
}
