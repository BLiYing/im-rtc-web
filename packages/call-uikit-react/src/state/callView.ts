import type { MediaType } from '@im-rtc/call-engine';

import {
  addInvited, applyNetwork, applySpeakers, newParticipant, removeParticipant, revealVideo,
  revokeLastInvited, setVideo, settleParticipant, withParticipant,
} from './participants.js';
import { initialCallView } from './viewTypes.js';
import type { CallViewState, RingtoneKind, ViewAction } from './viewTypes.js';

export { initialCallView } from './viewTypes.js';
export type {
  CallPhase, CallViewState, ConnectionStatus, RemoteParticipant, RingtoneKind, SelfState, SettledOutcome, ViewAction,
} from './viewTypes.js';

/**
 * 通话界面的视图模型 —— **纯 reducer，不碰 React、不碰 DOM**。
 *
 * # 为什么要有这一层
 *
 * 界面上的每个状态都是若干个 engine 事件叠加出来的：谁在说话、谁开着摄像头、
 * 群里谁还在响铃。把这套叠加逻辑写在组件里，就只能靠点界面来验证；
 * 抽成纯函数之后它能被逐条驱动（CONVENTIONS §2）。
 *
 * # 它只消费公开事件表
 *
 * 输入全部来自 `events.ts` 那张表（= 设计文档 §7.5）。uikit 不是特权组件，
 * 没有私有通道——**缺信息就补回调表，不开后门**。
 */
export function reduceCallView(state: CallViewState, action: ViewAction): CallViewState {
  switch (action.type) {
    case 'callReceived':
      return {
        ...initialCallView,
        phase: 'incoming',
        callId: action.callId,
        mediaType: action.mediaType,
        isGroup: action.isGroup,
        role: 'callee',
        peerUid: action.isGroup ? '' : action.caller,
        callerUid: action.caller,
        inviterUid: action.inviter ?? action.caller,
        /*
          主叫先摆上（他一定在通话里），其余被邀请的人摆成「还在响铃」的占位格。

          不摆的话群通话在两侧长得不一样：主叫看到四格（含没接的），被叫只看到两格。
          `calleeIds` 里已经由 subscribeEngine 去掉了自己。
        */
        participants: [
          // 离场后被重新邀请回来的发起人收到的 caller 就是他自己：「自己」不是远端成员，不摆格子。
          ...(action.caller === action.selfUid ? [] : [newParticipant(action.caller, true)]),
          ...action.calleeIds.filter((uid) => uid !== action.caller).map((uid) => newParticipant(uid, false)),
        ],
        self: { ...initialCallView.self, cameraOn: defaultCameraOn(action.mediaType, action.isGroup) },
        connection: state.connection,
        chatGroupId: action.chatGroupId,
        userData: action.userData,
      };

    case 'callPlaced':
      return {
        // 呼出时对方还没接——**先摆上去且标成未接听**，界面才有「正在响铃」的格子。
        ...addInvited(
          { ...initialCallView, connection: state.connection },
          action.calleeIds,
        ),
        phase: 'outgoing',
        mediaType: action.mediaType,
        isGroup: action.isGroup,
        role: 'caller',
        peerUid: action.isGroup ? '' : (action.calleeIds[0] ?? ''),
        self: { ...initialCallView.self, cameraOn: defaultCameraOn(action.mediaType, action.isGroup) },
        chatGroupId: action.chatGroupId,
        userData: action.userData,
      };

    case 'callBegin':
      return {
        ...state,
        // callBegin 只说「通话建立」，媒体不一定通了，所以先进 connecting——
        // 除非媒体已经先一步就绪了（会议场景常见）。
        phase: state.isMediaReady ? 'active' : 'connecting',
        callId: action.callId,
        roomId: action.roomId,
        mediaType: action.mediaType,
        isGroup: action.isGroup,
        role: action.role,
        beganAtMs: action.nowMs,
        hint: '',
        // caller 侧不必覆盖（自己就是发起人，callerUid 留空）；callee 侧可能是靠 joinCall
        // 直接进来的，没经过 callReceived，callerUid 只能从这里第一次拿到。
        callerUid: action.role === 'callee' ? (action.caller || state.callerUid) : state.callerUid,
        // 同理：群号 / user_data 优先用 callBegin 自己带的（engine 已经做过一层回落，
        // 见 CallEngine 的 callBegin 事件注释），callReceived 没发生过时这里是唯一来源。
        chatGroupId: action.chatGroupId || state.chatGroupId,
        userData: action.userData || state.userData,
      };

    case 'joinCallRequested':
      // 直接进「接通中…」，不经过来电页（HOST_INTEGRATION_DESIGN §3.4）。
      return {
        ...initialCallView,
        phase: 'connecting',
        callId: action.callId,
        isGroup: true,
        role: 'callee',
        connection: state.connection,
      };

    case 'joinCallFailed':
      /*
        **自己把阶段收到 `ended`，不指望等一条独立的 `callEnd`。**

        真 engine 确实会在这之前或之后紧跟着抛一条 `callEnd(reason:'error')`
        （`call.join` 在 rollback 表里，与 `call.invite` 同一条路径），但那条事件的
        到达时机不该是这里的前提——`useCallActions.joinCall` 只保证在
        `engine.joinCall()` 落定之后才回来通知失败，具体几条事件、先后顺序都是
        实现细节。真来了一条 `callEnd(reason:'error')` 也不冲突：`endReason`/`phase`
        会被这里的值原样再写一遍，是幂等的。
      */
      return {
        ...state, phase: 'ended', endReason: 'error', endedDurationSec: 0, isMinimized: false,
        joinDeniedText: joinDeniedTextFor(action.code),
      };

    case 'meetingJoined':
      return {
        ...initialCallView,
        // 会议没有振铃，进来就是「接通中」；媒体一通就转 active。
        phase: 'connecting',
        roomId: action.roomId,
        mediaType: 'video',
        isGroup: true,
        isMeeting: true,
        beganAtMs: action.nowMs,
        // **会议房仍默认开摄像头**：与 iOS / Android 一致，改它要重验真机。
        self: { ...initialCallView.self, cameraOn: true },
        connection: state.connection,
      };

    case 'roomLeft':
      // 会议的结束出口。**已经在 ended/idle 就不动**：
      // 通话结束时房间也会被清掉，那条路已经由 callEnd 收尾了，重复进 ended 会把
      // endReason 抹成空串。
      return state.phase === 'idle' || state.phase === 'ended'
        ? state
        : { ...state, phase: 'ended', isMinimized: false };

    case 'mediaReady': {
      const ready = { ...state, isMediaReady: true };
      return state.phase === 'connecting' ? { ...ready, phase: 'active' } : ready;
    }

    case 'callEnd':
      /*
        **振铃通话的结束出口**（会议走 roomLeft）。

        还在响铃的来电直接收起，不留结束画面：被叫这一侧什么都还没做，
        界面上只有一个来电浮层，该做的就是让它消失。
        主叫那一侧不一样：拨出去没打通，人需要知道为什么，所以停一下说明原因。
      */
      if (state.phase === 'incoming') return { ...initialCallView, connection: state.connection };
      /*
        **已经收起来了就不再弹结束画面。** 红键看门狗本地收场、界面收起之后，engine 的
        callEnd（或服务端迟到的那条）还会再来一次；照样进 ended 的话「通话已结束」又闪一下
        （2026-09-13 14:58:21 iOS frank 撞上过）。界面上什么都没有时，没有东西可结束。
      */
      if (state.phase === 'idle') return state;
      return {
        ...state,
        phase: 'ended',
        endReason: action.reason,
        endedDurationSec: action.durationSec,
        isMinimized: false,
      };

    case 'localCamera':
      return { ...state, localCameraCid: action.cid };

    case 'cameraBlocked':
      return { ...state, self: { ...state.self, cameraOn: false, cameraBlocked: true } };

    case 'dismiss':
      return { ...initialCallView, connection: state.connection };

    case 'invited':
      // **整批替换**而不是累加：只有最近这一批失败了才收，与 iOS `lastInvited` 同形。
      return { ...addInvited(state, action.uids), lastInvited: action.uids };

    case 'userEnter':
    case 'userAccept':
      return withParticipant(state, action.uid, (p) => ({ ...p, hasAccepted: true, settled: '' }));

    case 'userLeave':
    case 'userRemove':
      return removeParticipant(state, action.uid);

    /*
      群通话里某人拒接 / 没接：**先在格子上写明终局，停一会再收**（交互稿 §05 G3）。
      直接收掉的话拒接就跟没发生过一样。**这在群通话里是唯一的信号**：那边没有便利事件
      （不变量 I7），只有 onUser*。1v1 也会抛，但紧跟着就是 callEnd，界面整个收走。
    */
    case 'userSettled':
      return settleParticipant(state, action.uid, action.outcome);

    case 'inviteDenied':
      return { ...state, canInvite: false, hint: '你已不在通话中，无法添加成员' };

    case 'inviteRevoked':
      return revokeLastInvited(state);

    /*
      **1409：宿主的邀请鉴权回调拒了。** 同一个错误码在三个场合会出现（HOST_INTEGRATION_DESIGN
      §3.4）：初始 `call()` 被拒、通话中 `inviteMore` 被拒、主动 `joinCall()` 被拒——
      只有前两个走这条路，第三个自己有专属出口（见下）。

      **怎么分辨「主动加入还没成」**：`joinCallRequested` 把 `phase` 打成 `connecting` 但
      **不带 `roomId`**（要等 `callBegin` 才有）；`inviteMore` 只在通话已经 `connected`/
      `connecting`（这时 `roomId` 早就有了）才可能被服务端接受再拒绝。
      两者在“`connecting` 且 `roomId` 是空的”这一点上互斥，不需要另开一个标志位。
      命中时什么都不做——`useCallActions.joinCall` 自己订阅 `error` 拿码，
      经 `joinCallFailed` 走 `callEnd` 出口显示「无法加入该通话」，这里再冒一句
      「对方暂时无法被邀请」就是同一次拒绝提示两遍。
    */
    case 'inviteRejectedByHost': {
      if (state.phase === 'connecting' && state.roomId === '') return state;
      const revoked = revokeLastInvited(state);
      /*
        初始 invite 被拒时 `phase` 还是 `outgoing`，接下来立刻是 `callEnd`（同一个 JS 执行栈内，
        见 `frameLoop.ts` 的 `rollback`）——`CallOverlay` 到 `ended` 阶段换成 `CallEnded`，
        那边不读 `hint`（`ActiveCall` 才读），所以单独记一份让它在收起之后也看得见。
        通话中 `inviteMore` 被拒不动 `phase`，`hint` 在 `ActiveCall` 的状态行里已经够用，
        不写 `endHint`——它只应该在真的要收场的那一次被点亮，其余时候维持 `initialCallView`
        给的空串，不去主动清写别处可能已经合法置上的值。
      */
      return state.phase === 'outgoing'
        ? { ...revoked, hint: '对方暂时无法被邀请', endHint: '对方暂时无法被邀请' }
        : { ...revoked, hint: '对方暂时无法被邀请' };
    }

    case 'userAudio':
      return withParticipant(state, action.uid, (p) => ({ ...p, hasAudio: action.available }));

    case 'userVideo':
      return setVideo(state, action.uid, action.available);

    case 'videoRevealed':
      return revealVideo(state, action.uid);

    case 'activeSpeakers':
      return applySpeakers(state, action.speakers, action.selfUid);

    case 'networkQuality':
      return applyNetwork(state, action.entries);

    case 'connection':
      return { ...state, connection: action.status };

    case 'hint':
      return { ...state, hint: action.text };

    /*
      提示是**一次性的**：`statusLine` 里 hint 优先于时长，不清的话
      「通话已满员」会顶着标题栏直到通话结束，计时器再也不出现。
      只清掉自己那条——中途又来一条新提示时，不该被上一条的计时器抹掉。
    */
    case 'hintExpired':
      return state.hint === action.text ? { ...state, hint: '' } : state;

    case 'setMic':
      return { ...state, self: { ...state.self, micOn: action.on } };

    case 'setCamera':
      // 权限被拒时开不了：按钮本来就是禁用态，这里再挡一道免得状态漂移。
      if (state.self.cameraBlocked && action.on) return state;
      return {
        ...state,
        self: {
          ...state.self,
          cameraOn: action.on,
          // 只有来电页上的这一下算「以语音接听」；接通后的开关与它无关。
          cameraOptedOut: state.phase === 'incoming' ? !action.on : state.self.cameraOptedOut,
        },
      };

    case 'setMinimized':
      return { ...state, isMinimized: action.minimized };

    case 'setSwapped':
      return { ...state, isSwapped: action.swapped };

    case 'expandIncoming':
      // 只有还在响铃时点得开：接通 / 结束之后迟到的点击不该留一个标志给下一通。
      return state.phase === 'incoming' ? { ...state, isBannerExpanded: true } : state;

    default:
      return state;
  }
}

/**
 * defaultCameraOn 是振铃通话进来时摄像头的默认态：**1v1 视频开、群通话关**（设计稿 v3.5）。
 *
 * 拨出与来电必须走同一个判据——只改一条的话，群视频来电页上那颗按钮会显示成已开启。
 * 三端同名同义：iOS `imDefaultCameraOn`、Android `IMCallViewReducer.defaultCameraOn`。
 */
export function defaultCameraOn(mediaType: MediaType, isGroup: boolean): boolean {
  return mediaType === 'video' && !isGroup;
}

/**
 * showsIncomingPage 决定来电时显示来电页还是横幅。
 *
 * `bannerFirst`（默认 true）= 先出横幅、点开才进来电页；false = 来电直接进来电页。
 * 与 iOS `IMCallWindow.desiredMode` 同一条判据。
 */
export function showsIncomingPage(state: CallViewState, bannerFirst: boolean): boolean {
  return state.phase === 'incoming' && (!bannerFirst || state.isBannerExpanded);
}

/** isCallVisible 判断此刻界面上该不该有通话 UI。 */
export function isCallVisible(state: CallViewState): boolean {
  return state.phase !== 'idle';
}

/**
 * ringtoneFor 决定此刻该响来电铃声、回铃音，还是不响（`useRingtone` 的判据）。
 *
 * 三端同名同义（`ringtoneFor`）。规则按优先级：
 * - `muted`（宿主传的 `ringtoneMuted`，或本端已手动静音）为 true → 一律不响；
 * - 会议房（`isMeeting`）没有振铃这回事 → 不响；
 * - `incoming` 阶段响来电铃声，`outgoing` 阶段响回铃音；
 * - 其余阶段（接通中 / 通话中 / 结束 / 空闲）都不响。
 */
export function ringtoneFor(state: CallViewState, muted: boolean): RingtoneKind {
  if (muted || state.isMeeting) return 'none';
  if (state.phase === 'incoming') return 'incoming';
  if (state.phase === 'outgoing') return 'ringback';
  return 'none';
}

/**
 * canShowInvite 决定要不要给「添加成员」入口（交互稿 §05）。
 *
 * 条件缺一不可：是群通话（会议房没有 call，走的是别的加人机制）、已接通、房间没满（含本端 9 人）。
 * **不看主叫被叫**：通话里的任何人都能加人（2026-09-15 起）；还在响铃的人阶段不对，自然没有入口。
 */
export function canShowInvite(state: CallViewState, maxParticipants = 9): boolean {
  return state.isGroup && !state.isMeeting && state.canInvite
    && state.participants.length + 1 < maxParticipants
    && (state.phase === 'active' || state.phase === 'connecting');
}

/** inviteSlotsLeft 是还能加几个人（顶部「还能加 N 人」）。 */
export function inviteSlotsLeft(state: CallViewState, maxParticipants = 9): number {
  return Math.max(maxParticipants - 1 - state.participants.length, 0);
}

/**
 * joinDeniedTextFor 是 `joinCall()` 被拒时给用户看的那句话（HOST_INTEGRATION_DESIGN §3.4：
 * 「加入时『无法加入该通话』」）。会在 `call.join` 上出现的码不止 1409
 * （1401/1402/1405/1408/1202 同样会走这条路），设计稿只钦定了一句通用文案，
 * 不按码细分——都不含内部信息，说细了反而像是在解释服务端的裁决。
 *
 * `code` 参数留着不是没用的：调用方（`useCallActions.joinCall`）已经把它记进日志，
 * 这里单独收着方便以后按码拆细，不必再回头改调用点。
 */
export function joinDeniedTextFor(_code: number): string {
  return '无法加入该通话';
}
