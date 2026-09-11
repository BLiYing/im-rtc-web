import type { ReactNode } from 'react';

import { avatarGradient, avatarInitial } from '../format/avatar.js';
import { useDisplayName, useParticipantProfile } from '../profile.js';
import { showsCameraButton } from './ControlBar.js';
import { ControlButton } from './ControlButton.js';
import { incomingInviteText } from './IncomingControls.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';

/**
 * IncomingCall 是来电横幅（规范 §06「来电横幅」）：头像 38 + 两行字 + 摄像头 / 拒绝 / 接听。
 *
 * **先出横幅、不直接盖住整页**：宿主的界面不该被我们整个盖住——用户可能正在看别的东西。
 * **点横幅本体展开成来电页**（草图 §04-I，四端一致），那一页才有大头像、本端预览与群来电的九宫格。
 * 宿主不想要横幅可以传 `bannerFirst={false}`，来电直接进来电页。
 *
 * 按钮那一栏自己吃掉点击（`stopPropagation`）：点接听 / 拒绝不会顺带把横幅展开一下。
 */
export function IncomingCall(): ReactNode {
  const { state, actions } = useCall();
  const caller = state.participants[0]?.uid ?? state.peerUid;
  /*
    来电屏是**最不能显示成一串 uid** 的一屏，但它也是最可能解析不出来的一屏：
    陌生人来电时宿主本机没有对方的名片。解析不到就退化成 uid（宿主可自行兜底），
    解析到了就立刻显示——宿主的解析器拉回来后会通过 subscribe 通知重画。
  */
  const callerName = useDisplayName(caller, caller);
  const callerAvatar = useParticipantProfile(caller)?.avatarUrl ?? '';

  return (
    <div
      style={{ ...styles.toast, cursor: 'pointer' }}
      role="alertdialog"
      aria-label="来电"
      data-testid="incoming-call"
      onClick={() => actions.expandIncoming()}
    >
      {callerAvatar === '' ? (
        // 底色按 uid、首字母按显示名——同 VideoTile，理由见那边的注释。
        <div style={{ ...styles.toastAvatar, background: avatarGradient(caller) }}>
          {avatarInitial(callerName)}
        </div>
      ) : (
        <img src={callerAvatar} alt="" style={{ ...styles.toastAvatar, objectFit: 'cover' }} data-testid="incoming-avatar" />
      )}
      <div style={styles.toastText}>
        <div style={styles.title}>{callerName}</div>
        <div style={{ ...styles.subtitle, justifyContent: 'flex-start' }}>
          {incomingInviteText(state.mediaType, state.isGroup)}
        </div>
      </div>
      {/* 与通话页、与 iOS 用同一套圆形按钮：同一个产品不该有两种按钮长相。 */}
      <div style={styles.toastActions} onClick={(e) => e.stopPropagation()}>
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
