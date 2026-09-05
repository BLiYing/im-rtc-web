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
/**
 * showsCameraButton 决定通话中给不给「摄像头」按钮。
 *
 * # 只看 media_type，不看本端摄像头开没开
 *
 * **语音通话里不给这个按钮。** 协议上没有「转视频」这回事：`media_type` 只在
 * `call.invite` 时定死，是振铃界面的元数据；进了房之后房间根本不认识它，
 * 你在一通语音通话里发布摄像头轨道，服务端照收、对端照样收到
 * `userVideoAvailable(true)`。
 *
 * 所以原先那个按钮是**半实现**：点了确实出镜、对方确实看得见，而本端预览的 cid
 * 在这条路上压根没记进视图状态，于是**你自己不知道自己已经出镜了**。
 * 这比「不支持」危险得多，所以按钮直接不给。
 * 想真正支持，要的是「邀请对方转视频」那一整套（`call.upgrade_request` /
 * `upgrade_accept|reject`）——那是协议改动，改五个仓，单独一刀。
 *
 * 判据必须是 `mediaType` 而**不是**「本端摄像头开没开」：视频通话里把摄像头
 * 关掉之后按钮仍然要有——对方本来就知道这是视频通话。
 * 会议房的 `mediaType` 恒为 `video`，所以它天然留着按钮。
 *
 * 与 iOS 的 `imShowsCameraButton(for:)` 是同一条判据。
 */
export function showsCameraButton(mediaType: string): boolean {
  return mediaType === 'video';
}

export function ControlBar(): ReactNode {
  const { state, actions } = useCall();

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

      {showsCameraButton(state.mediaType) && (
        <ControlButton
          icon="video-slash"
          caption="开摄像头"
          onIcon="video"
          onCaption="关摄像头"
          isOn={state.self.cameraOn}
          onClick={() => void actions.toggleCamera()}
          testId="toggle-camera"
        />
      )}

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
