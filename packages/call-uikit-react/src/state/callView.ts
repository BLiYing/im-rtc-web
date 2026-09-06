import {
  addInvited, applyNetwork, applySpeakers, newParticipant, removeParticipant, settleParticipant,
  withParticipant,
} from './participants.js';
import { initialCallView } from './viewTypes.js';
import type { CallViewState, ViewAction } from './viewTypes.js';

export { initialCallView } from './viewTypes.js';
export type {
  CallPhase, CallViewState, ConnectionStatus, RemoteParticipant, SelfState, SettledOutcome, ViewAction,
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
        /*
          主叫先摆上（他一定在通话里），其余被邀请的人摆成「还在响铃」的占位格。

          不摆的话群通话在两侧长得不一样：主叫看到四格（含没接的），被叫只看到两格。
          `calleeIds` 里已经由 subscribeEngine 去掉了自己。
        */
        participants: [
          newParticipant(action.caller, true),
          ...action.calleeIds.filter((uid) => uid !== action.caller).map((uid) => newParticipant(uid, false)),
        ],
        self: { micOn: true, cameraOn: action.mediaType === 'video', cameraBlocked: false },
        connection: state.connection,
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
        self: { micOn: true, cameraOn: action.mediaType === 'video', cameraBlocked: false },
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
        self: { micOn: true, cameraOn: true, cameraBlocked: false },
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
      return addInvited(state, action.uids);

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
      return { ...state, canInvite: false, hint: '只有发起人可以添加成员' };

    case 'userAudio':
      return withParticipant(state, action.uid, (p) => ({ ...p, hasAudio: action.available }));

    case 'userVideo':
      return withParticipant(state, action.uid, (p) => ({ ...p, hasVideo: action.available }));

    case 'activeSpeakers':
      return applySpeakers(state, action.speakers);

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
      return state.self.cameraBlocked && action.on
        ? state
        : { ...state, self: { ...state.self, cameraOn: action.on } };

    case 'setMinimized':
      return { ...state, isMinimized: action.minimized };

    case 'setSwapped':
      return { ...state, isSwapped: action.swapped };

    default:
      return state;
  }
}

/** isCallVisible 判断此刻界面上该不该有通话 UI。 */
export function isCallVisible(state: CallViewState): boolean {
  return state.phase !== 'idle';
}

/**
 * canShowInvite 决定要不要给「添加成员」入口（交互稿 §05）。
 *
 * 三个条件缺一不可：是群通话（会议房没有 call，走的是别的加人机制）、
 * 本端是主叫（协议 1407：非主叫发 `invite_more` 会被拒）、房间没满（含本端 9 人）。
 */
export function canShowInvite(state: CallViewState, maxParticipants = 9): boolean {
  return state.isGroup && !state.isMeeting && state.role === 'caller' && state.canInvite
    && state.participants.length + 1 < maxParticipants
    && (state.phase === 'active' || state.phase === 'connecting');
}

/** inviteSlotsLeft 是还能加几个人（顶部「还能加 N 人」）。 */
export function inviteSlotsLeft(state: CallViewState, maxParticipants = 9): number {
  return Math.max(maxParticipants - 1 - state.participants.length, 0);
}
