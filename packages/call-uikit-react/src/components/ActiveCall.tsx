import type { ReactNode } from 'react';
import { useState } from 'react';

import { formatDuration } from '../format/duration.js';
import { buildInviteContext } from '../invite/inviteContext.js';
import { defaultPipCorner, pipSizeFor } from '../layout/pip.js';
import type { CallViewState } from '../state/viewTypes.js';
import { useAutoHide } from '../useAutoHide.js';
import { useCall } from '../useCall.js';
import { useElapsed } from '../useElapsed.js';
import { useElementSize } from '../useElementSize.js';
import { styles } from '../styles.js';
import { callMotion } from '../theme.js';
import { AudioStage } from './AudioStage.js';
import { useDisplayName } from '../profile.js';
import { CallHeader } from './CallHeader.js';
import { ControlBar } from './ControlBar.js';
import { GridStage } from './GridStage.js';
import { IncomingControls, incomingInviteText } from './IncomingControls.js';
import { InvitePicker } from './InvitePicker.js';
import { MeetingStage } from './MeetingStage.js';
import { MemberList } from './MemberList.js';
import { PipView } from './PipView.js';
import { TopBanner } from './TopBanner.js';
import { VideoStage } from './VideoStage.js';
import { t } from '../i18n/index.js';

/**
 * ActiveCall 是通话主界面，三种版式（规范 §03 / §04）：
 * - **audio**：语音通话、拨出中 —— 96 头像 + 名字 + 状态；
 * - **video**：1v1 视频通话中 —— 远端全屏 + 本端小窗，控制条 3s 自动隐藏；
 * - **grid**：群通话 / 会议 —— 九宫格（加人入口只在标题栏右上角那一颗）。
 *
 * 三种版式共用头部、控制条与静音 / 发言等状态，分成三个组件的话这些要维护三遍。
 * 版式由 `pickLayout` 决定，它是纯函数，好测。
 *
 * **来电页也是它**（草图 §03-F，横幅点开之后那一屏）：版式同样由 `pickLayout` 定——1v1 是语音版式
 * + 本端小窗，群来电是九宫格；只把底部控制条换成「摄像头 / 拒绝 / 接听」，标题栏不给小窗键。
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
  const { state, engine, actions, invite } = useCall();
  const seconds = useElapsed(state.beganAtMs);
  const [picker, setPicker] = useState(false);
  // 成员列表是会议房专有的半屏面板（§4.6）。与选人页一样归这一层管——
  // 它们都是「盖在通话页上的一张纸」，舞台组件不该知道有这种东西。
  const [members, setMembers] = useState(false);
  /**
   * handleInvite 决定「添加成员」按钮按下去之后**该不该把 InvitePicker 弹出来**。
   *
   * 取名单优先级第一位是 `presentInvitePicker`（HOST_INTEGRATION_DESIGN §3.4）：宿主接管了
   * 选人页，这一层**根本不挂载 InvitePicker**——由宿主自己的页面完成选人，选完把 uid
   * 交回，仍然由 uikit 调 `inviteMore`（一等公民只有一条，不能宿主自己直接摸信令）。
   * 返回 `null` 表示这次不接管，退回 `inviteMemberProvider` / 静态名单，那就正常弹半屏。
   */
  const handleInvite = (): void => {
    if (invite.onRequest === undefined) {
      setPicker(true);
      return;
    }
    void invite.onRequest(buildInviteContext(engine, state)).then((uids) => {
      // null = 这次不接管：退回 inviteMemberProvider / 静态名单，正常弹半屏。
      if (uids === null) { setPicker(true); return; }
      if (uids.length > 0) void actions.inviteMore(uids);
    });
  };
  const layout = pickLayout(state);
  const peer = state.participants[0];
  // 标题栏的 1v1 对方名字交给宿主解析；群通话 / 会议的标题与宿主无关（uid 传空串 = 不解析）。
  const headerTitle = useDisplayName(state.isGroup || state.isMeeting ? '' : state.peerUid, title(state, state.participants.length));
  // 只有视频版式藏控制条：语音页、拨出中、九宫格上没有画面需要让出来。
  const hide = useAutoHide(layout === 'video' && state.phase === 'active');
  const incoming = state.phase === 'incoming';
  const bare = incoming || state.phase === 'outgoing';
  const chrome = { opacity: hide.visible ? 1 : 0, transition: `opacity ${callMotion.fadeMs}ms ease`, pointerEvents: hide.visible ? 'auto' as const : 'none' as const };

  return (
    <div
      style={{ ...styles.overlay, ...(layout === 'audio' ? styles.overlayAudio : {}) }}
      data-testid={incoming ? 'incoming-page' : 'active-call'}
      data-layout={layout}
      {...(incoming ? { role: 'dialog', 'aria-label': t('incoming.aria') } : {})}
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
          title={bare ? '' : headerTitle}
          subtitle={bare ? '' : statusLine(state, seconds)}
          networkLevel={state.isGroup ? 0 : (peer?.networkLevel ?? 0)}
          onInvite={handleInvite}
          showsMinimize={!incoming}
          {...(state.isMeeting && !incoming && state.phase !== 'ended'
            // 收场之后不给「👥 N」：会议已经散了，点开是一张名单在数还没走干净的人。
            ? { onMembers: () => setMembers(true) }
            : {})}
          {...(state.isMeeting && !bare && state.phase !== 'ended' && state.roomId !== ''
            // 标题是房号时才可点（复制）。收场之后不给：房间已经散了。
            ? { onTitleClick: () => { void actions.copyRoomId(); } }
            : {})}
        />
      </div>

      {/* 会议房走分页画廊；群通话还是老的九宫格，一行都没变（§3 的门控表）。 */}
      {layout === 'grid' && (state.isMeeting ? <MeetingStage /> : <GridStage />)}
      {layout === 'video' && peer !== undefined && (
        <VideoStage peer={peer} controlsVisible={hide.visible} onStageTap={hide.toggle} />
      )}
      {layout === 'audio' && <AudioWithPreview state={state} seconds={seconds} />}

      <div style={layout === 'video' ? {} : { flex: 'none' }}>
        {incoming ? <IncomingControls /> : <ControlBar onVideo={layout === 'video'} visible={hide.visible} />}
      </div>
      {picker && <InvitePicker onClose={() => setPicker(false)} />}
      {members && <MemberList members={state.participants} onClose={() => setMembers(false)} />}
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
  const who = (state.phase === 'incoming' ? state.inviterUid : '') || state.peerUid || peer?.uid || '';
  return (
    <div ref={stage.ref} style={{ ...styles.stage, flexDirection: 'column' }}>
      <AudioStage
        uid={who}
        name={who || t('call.ongoing')}
        status={statusLine(state, seconds)}
        isRinging={state.phase === 'outgoing'}
        networkLevel={peer?.networkLevel ?? 0}
        // 接通之后名字与时长归标题栏，中间只留头像——两处各走各的计时是重复也是打架。
        showsCaption={state.phase !== 'active'}
      />
      {showPreview && (
        <PipView
          tile={{ uid: '', label: t('self'), hasVideo: true, hasAudio: state.self.micOn, localCid: state.localCameraCid }}
          size={pipSizeFor(stage.width, stage.height)}
          bounds={{ width: stage.width, height: stage.height }}
          corner={defaultPipCorner}
          onCorner={() => undefined}
          lift={0}
          onTap={() => undefined}
          ariaLabel={t('aria.selfView')}
        />
      )}
    </div>
  );
}

/**
 * 标题：会议写**房号**，群通话写人数（含自己），1v1 写对方 uid。
 *
 * 会议不写人数：右上角那颗「👥 N」已经是人数的出处，标题再写一遍是同一个数字的第二处真相。
 * 房号才是这一屏里**要念给别人听**的那个东西（点一下复制）。
 */
function title(state: CallViewState, others: number): string {
  if (state.isMeeting) return state.roomId === '' ? t('call.meeting') : t('call.meetingRoom', { room: state.roomId });
  if (!state.isGroup) return state.peerUid || t('call.ongoing');
  return t('call.group', { n: others + 1 });
}

function statusLine(state: CallViewState, seconds: number): string {
  if (state.hint !== '') return state.hint;
  if (state.phase === 'outgoing') return t('call.status.calling');
  if (state.phase === 'incoming') return incomingInviteText(state.mediaType, state.isGroup);
  if (state.phase === 'connecting') return t(state.isMeeting ? 'call.status.enteringMeeting' : 'call.status.connecting');
  if (state.phase === 'ended') return t(state.isMeeting ? 'end.meetingLeft' : 'call.status.ended');
  return formatDuration(seconds);
}
