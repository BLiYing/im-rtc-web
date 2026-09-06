import type { ReactNode } from 'react';
import { useState } from 'react';

import { formatDuration } from '../format/duration.js';
import { defaultPipCorner, pipSizeFor } from '../layout/pip.js';
import type { CallViewState } from '../state/viewTypes.js';
import { useAutoHide } from '../useAutoHide.js';
import { useCall } from '../useCall.js';
import { useElapsed } from '../useElapsed.js';
import { useElementSize } from '../useElementSize.js';
import { styles } from '../styles.js';
import { callMotion } from '../theme.js';
import { AudioStage } from './AudioStage.js';
import { CallHeader } from './CallHeader.js';
import { ControlBar } from './ControlBar.js';
import { GridStage } from './GridStage.js';
import { InvitePicker } from './InvitePicker.js';
import { PipView } from './PipView.js';
import { TopBanner } from './TopBanner.js';
import { VideoStage } from './VideoStage.js';

/**
 * ActiveCall 是通话主界面，三种版式（规范 §03 / §04）：
 * - **audio**：语音通话、拨出中 —— 96 头像 + 名字 + 状态；
 * - **video**：1v1 视频通话中 —— 远端全屏 + 本端小窗，控制条 3s 自动隐藏；
 * - **grid**：群通话 / 会议 —— 九宫格 + 加号格。
 *
 * 三种版式共用头部、控制条与静音 / 发言等状态，分成三个组件的话这些要维护三遍。
 * 版式由 `pickLayout` 决定，它是纯函数，好测。
 */
export type CallLayout = 'audio' | 'video' | 'grid';

/**
 * pickLayout 决定此刻用哪种版式。
 *
 * **接通后的 1v1 视频恒为 video 版式**，哪怕两边都关着摄像头——那时全屏格与小窗各显示一个
 * 头像盘。原先是「都没画面就退回语音版式」，实测下来不对：小窗会整个消失，用户以为通话断了，
 * 而且关掉摄像头之后就再也点不到「互换」。没画面是格子的事，不是版式的事。
 *
 * 拨出中与来电页仍用语音版式：那时对端画面不存在，本端预览叠在右上角。
 * 与 iOS 的 `imPickLayout(for:)` 是同一条判据。
 */
export function pickLayout(state: CallViewState): CallLayout {
  if (state.isGroup || state.isMeeting) return 'grid';
  if (state.mediaType !== 'video') return 'audio';
  if (state.phase === 'outgoing' || state.phase === 'incoming') return 'audio';
  return 'video';
}

export function ActiveCall(): ReactNode {
  const { state } = useCall();
  const seconds = useElapsed(state.beganAtMs);
  const [picker, setPicker] = useState(false);
  const layout = pickLayout(state);
  const peer = state.participants[0];
  // 只有视频版式藏控制条：语音页、拨出中、九宫格上没有画面需要让出来。
  const hide = useAutoHide(layout === 'video' && state.phase === 'active');
  const bare = state.phase === 'incoming' || state.phase === 'outgoing';
  const chrome = { opacity: hide.visible ? 1 : 0, transition: `opacity ${callMotion.fadeMs}ms ease`, pointerEvents: hide.visible ? 'auto' as const : 'none' as const };

  return (
    <div
      style={{ ...styles.overlay, ...(layout === 'audio' ? styles.overlayAudio : {}) }}
      data-testid="active-call"
      data-layout={layout}
      onPointerMove={hide.poke}
    >
      <TopBanner />
      <div style={chrome}>
        {/*
          **呼叫中与来电页的标题栏留空。** 那两屏的正中间已经是「大头像 + 名字 + 状态」，
          顶部再写一遍同样的名字和同一行状态，同一句话在一屏里出现两次。
          接通之后才有真正只属于顶栏的信息（对方名字 + 计时器 + 网络条）。
        */}
        <CallHeader
          title={bare ? '' : title(state, state.participants.length)}
          subtitle={bare ? '' : statusLine(state, seconds)}
          networkLevel={state.isGroup ? 0 : (peer?.networkLevel ?? 0)}
          onInvite={() => setPicker(true)}
        />
      </div>

      {layout === 'grid' && <GridStage onInvite={() => setPicker(true)} />}
      {layout === 'video' && peer !== undefined && (
        <VideoStage peer={peer} controlsVisible={hide.visible} onStageTap={hide.toggle} />
      )}
      {layout === 'audio' && <AudioWithPreview state={state} seconds={seconds} />}

      <div style={layout === 'video' ? {} : { flex: 'none' }}>
        <ControlBar onVideo={layout === 'video'} visible={hide.visible} />
      </div>
      {picker && <InvitePicker onClose={() => setPicker(false)} />}
    </div>
  );
}

/**
 * AudioWithPreview 是语音版式；**视频呼出的拨出中**要在右上角叠一个本端预览
 * （草图 §03-E：拨出时看得见自己）。这时它不能互换（对端还没画面），只能拖。
 */
function AudioWithPreview({ state, seconds }: { readonly state: CallViewState; readonly seconds: number }): ReactNode {
  const stage = useElementSize<HTMLDivElement>();
  const peer = state.participants[0];
  const showPreview = state.mediaType === 'video' && state.self.cameraOn && state.localCameraCid !== '';
  return (
    <div ref={stage.ref} style={{ ...styles.stage, flexDirection: 'column' }}>
      <AudioStage
        name={state.peerUid || peer?.uid || '通话中'}
        status={statusLine(state, seconds)}
        isRinging={state.phase === 'outgoing'}
        networkLevel={peer?.networkLevel ?? 0}
      />
      {showPreview && (
        <PipView
          tile={{ uid: '', label: '我', hasVideo: true, hasAudio: state.self.micOn, localCid: state.localCameraCid }}
          size={pipSizeFor(stage.width, stage.height)}
          bounds={{ width: stage.width, height: stage.height }}
          corner={defaultPipCorner}
          onCorner={() => undefined}
          lift={0}
          onTap={() => undefined}
          ariaLabel="本端画面"
        />
      )}
    </div>
  );
}

function title(state: CallViewState, others: number): string {
  if (state.isMeeting) return `会议 · ${others + 1} 人`;
  if (!state.isGroup) return state.peerUid || '通话中';
  return `群通话 · ${others + 1} 人`;
}

function statusLine(state: CallViewState, seconds: number): string {
  if (state.hint !== '') return state.hint;
  if (state.phase === 'outgoing') return '正在呼叫…';
  if (state.phase === 'connecting') return state.isMeeting ? '正在进入会议…' : '接通中…';
  if (state.phase === 'ended') return state.isMeeting ? '已离开会议' : '通话结束';
  return formatDuration(seconds);
}
