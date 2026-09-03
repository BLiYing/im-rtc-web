import type { ReactNode } from 'react';

import { useCall } from '../useCall.js';
import { styles } from '../styles.js';

/**
 * IncomingCall 是来电浮层（草图 §06 的来电条）。
 *
 * 做成顶部浮层而不是全屏页：**宿主的界面不该被我们整个盖住**——
 * 用户可能正在看别的东西，接不接是他的事。全屏来电页留给锁屏推送场景，
 * 那属于后续期（PushKit / CallKit）。
 */
export function IncomingCall(): ReactNode {
  const { state, actions } = useCall();
  const caller = state.participants[0]?.uid ?? state.peerUid;

  return (
    <div style={styles.toast} role="alertdialog" aria-label="来电" data-testid="incoming-call">
      <div>
        <div style={styles.title}>{caller}</div>
        <div style={styles.subtitle}>
          邀请你{state.mediaType === 'video' ? '视频' : '语音'}通话
          {state.isGroup ? '（群通话）' : ''}
        </div>
      </div>
      <div style={styles.toastActions}>
        <button
          type="button"
          style={{ ...styles.smallButton, background: '#e5484d' }}
          onClick={() => void actions.reject()}
          data-testid="reject-call"
        >
          拒接
        </button>
        <button
          type="button"
          style={{ ...styles.smallButton, background: '#3ddc84', color: '#08210f' }}
          onClick={() => void actions.accept()}
          data-testid="accept-call"
        >
          接听
        </button>
      </div>
    </div>
  );
}
