import type { ReactNode } from 'react';

import { avatarGradient, avatarInitial } from '../format/avatar.js';
import { showsCameraButton } from './ControlBar.js';
import { ControlButton } from './ControlButton.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';

/**
 * IncomingCall 是来电横幅（规范 §06「来电横幅」）：头像 38 + 两行字 + 拒绝 / 接听。
 *
 * 做成顶部横幅而不是全屏页：**宿主的界面不该被我们整个盖住**——
 * 用户可能正在看别的东西，接不接是他的事。全屏来电页留给锁屏推送场景，
 * 那属于后续期（PushKit / CallKit）。
 */
export function IncomingCall(): ReactNode {
  const { state, actions } = useCall();
  const caller = state.participants[0]?.uid ?? state.peerUid;

  return (
    <div style={styles.toast} role="alertdialog" aria-label="来电" data-testid="incoming-call">
      <div style={{ ...styles.toastAvatar, background: avatarGradient(caller) }}>{avatarInitial(caller)}</div>
      <div style={styles.toastText}>
        <div style={styles.title}>{caller}</div>
        <div style={{ ...styles.subtitle, justifyContent: 'flex-start' }}>
          {state.isGroup ? '邀请你加入群通话' : `邀请你${state.mediaType === 'video' ? '视频' : '语音'}通话`}
        </div>
      </div>
      {/* 与通话页、与 iOS 用同一套圆形按钮：同一个产品不该有两种按钮长相。 */}
      <div style={styles.toastActions}>
        {/*
          **视频来电多一个摄像头开关，而不是「以语音接听」按钮**（拍板 §11-10）。
          关掉它再接听就是同一件事，而且状态看得见、还能再打开。
          接听时只在摄像头开着才申请 / 推流——关着就连开都不开，指示灯不亮。
        */}
        {showsCameraButton(state.mediaType) && (
          <ControlButton
            icon="video-slash"
            caption="开摄像头"
            onIcon="video"
            onCaption="关摄像头"
            isOn={state.self.cameraOn}
            size="small"
            onClick={() => void actions.toggleCamera()}
            testId="incoming-toggle-camera"
          />
        )}
        <ControlButton
          role="danger"
          icon="xmark"
          caption="拒绝"
          size="small"
          onClick={() => void actions.reject()}
          testId="reject-call"
        />
        <ControlButton
          role="accept"
          icon="phone"
          caption="接听"
          size="small"
          onClick={() => void actions.accept()}
          testId="accept-call"
        />
      </div>
    </div>
  );
}
