import type { ReactNode } from 'react';

import { ControlButton } from './ControlButton.js';
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
      {/* 与通话页、与 iOS 用同一套圆形按钮：同一个产品不该有两种按钮长相。 */}
      <div style={styles.toastActions}>
        <ControlButton
          role="danger"
          icon="xmark"
          caption="拒接"
          onClick={() => void actions.reject()}
          testId="reject-call"
        />
        <ControlButton
          role="accept"
          icon="phone"
          caption="接听"
          onClick={() => void actions.accept()}
          testId="accept-call"
        />
      </div>
    </div>
  );
}
