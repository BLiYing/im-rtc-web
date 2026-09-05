import type { CallEndReasonValue, CallRoleName, MediaType } from '@im-rtc/call-engine';

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

/** CallPhase 是界面的阶段。注意它**不等于** engine 的状态机状态。 */
export type CallPhase =
  | 'idle'
  /** 收到来电，还没决定。 */
  | 'incoming'
  /** 已拨出，等对方响应。 */
  | 'outgoing'
  /** 对方接了，媒体还没通——UI 上是「接通中」。 */
  | 'connecting'
  /** 通话中。 */
  | 'active'
  /**
   * 已结束。
   *
   * **engine 的状态机里没有 `ended` 状态**（ended 是事件）——
   * 这里的 ended 是纯展示态：草图 §09 那个停 1.5 秒的方框。
   */
  | 'ended';

/** RemoteParticipant 是界面上的一个远端成员。 */
export interface RemoteParticipant {
  readonly uid: string;
  /** 对方的麦克风是否可用（`userAudioAvailable`）。 */
  readonly hasAudio: boolean;
  /** 对方的摄像头是否可用（`userVideoAvailable`）。 */
  readonly hasVideo: boolean;
  /** 是否正在说话（`activeSpeakers`，服务端节流 300ms）。 */
  readonly isSpeaking: boolean;
  /** 0~100 的音量，用来画音量条。 */
  readonly volume: number;
  /** 群通话里是否已接听。false = 还在响铃。 */
  readonly hasAccepted: boolean;
  /** 网络质量 0~6，0 = 未知。服务端节流 2s。 */
  readonly networkLevel: number;
}

/** SelfState 是本端的开关状态。 */
export interface SelfState {
  readonly micOn: boolean;
  readonly cameraOn: boolean;
}

/** CallViewState 是整个界面需要的全部数据。 */
export interface CallViewState {
  readonly phase: CallPhase;
  readonly callId: string;
  readonly roomId: string;
  readonly mediaType: MediaType;
  readonly isGroup: boolean;
  /**
   * 是不是「直接进会议房」而来的（`joinMeeting`），不是振铃通话。
   *
   * **界面必须分得清这件事**：会议房里根本没有 call，
   * 红按钮按 `hangup` 走会被状态机本地拒成 2005，**按钮点了没反应、人退不出去**。
   * 会议的结束动作是 `leaveRoom`。
   * （这条是三人会议实测撞出来的：三端都退不出 `r-596154f1eb6c4c86`。）
   */
  readonly isMeeting: boolean;
  readonly role: CallRoleName;
  /** 1v1 的对端 uid；群通话为空串。 */
  readonly peerUid: string;
  readonly participants: readonly RemoteParticipant[];
  readonly self: SelfState;
  /** 是否收进小窗。 */
  readonly isMinimized: boolean;
  /** 接通时刻（`Date.now()`），0 = 还没接通。计时器从它开始走。 */
  readonly beganAtMs: number;
  readonly endReason: CallEndReasonValue | '';
  /**
   * 本端摄像头轨道的 cid，空串 = 还没起摄像头。
   *
   * **进 state 是因为它决定渲染**：本端格子要显示画面还是头像，全看它有没有。
   * 原先靠「`publishTrackIds` 里的第二条就是摄像头」这个顺序去猜，
   * 而拨出中根本还没发布——于是**拨出时永远看不见自己**。
   */
  readonly localCameraCid: string;
  /** 一句给用户看的提示（「对方已拒接」这类）。 */
  readonly hint: string;
  /**
   * 媒体是否已经就绪。
   *
   * **单独记一个标志而不是只看阶段**：`callBegin` 与「媒体通了」谁先到都可能——
   * 会议场景里进房成功几乎与 callBegin 同时发生，先到的那个如果只在
   * 「阶段正好是 connecting」时才生效，就会被丢掉，界面永远停在「接通中」。
   * （这条和 CallProvider 里发布时机的那条是同一个教训。）
   */
  readonly isMediaReady: boolean;
}

/** initialCallView 是没有通话时的状态。 */
export const initialCallView: CallViewState = {
  phase: 'idle',
  callId: '',
  roomId: '',
  mediaType: 'audio',
  isGroup: false,
  isMeeting: false,
  role: '',
  peerUid: '',
  participants: [],
  self: { micOn: true, cameraOn: false },
  isMinimized: false,
  beganAtMs: 0,
  endReason: '',
  localCameraCid: '',
  hint: '',
  isMediaReady: false,
};

/**
 * ViewAction 是驱动视图模型的输入。
 *
 * 分成两类：`engine` 开头的来自事件表，其余是用户在界面上的动作。
 * **写成显式联合而不是把 EngineEvents 映射过来**：映射过来会把 uikit
 * 不消费的事件也拖进类型里，看不出「界面到底用了哪几个事件」。
 */
export type ViewAction =
  | { readonly type: 'callReceived'; readonly callId: string; readonly caller: string;
      readonly mediaType: MediaType; readonly isGroup: boolean }
  | { readonly type: 'callPlaced'; readonly calleeIds: readonly string[];
      readonly mediaType: MediaType; readonly isGroup: boolean }
  | { readonly type: 'callBegin'; readonly callId: string; readonly roomId: string;
      readonly mediaType: MediaType; readonly isGroup: boolean; readonly role: CallRoleName;
      readonly nowMs: number }
  | { readonly type: 'callEnd'; readonly reason: CallEndReasonValue }
  | { readonly type: 'localCamera'; readonly cid: string }
  /** 某人给出了终局裁决（拒接 / 无应答 / 忙线），格子该收掉了。 */
  | { readonly type: 'userSettled'; readonly uid: string }
  | { readonly type: 'meetingJoined'; readonly roomId: string; readonly nowMs: number }
  | { readonly type: 'roomLeft' }
  | { readonly type: 'mediaReady' }
  | { readonly type: 'userEnter'; readonly uid: string }
  | { readonly type: 'userLeave'; readonly uid: string }
  | { readonly type: 'userAccept'; readonly uid: string }
  | { readonly type: 'userAudio'; readonly uid: string; readonly available: boolean }
  | { readonly type: 'userVideo'; readonly uid: string; readonly available: boolean }
  | { readonly type: 'activeSpeakers'; readonly speakers: readonly { uid: string; volume: number }[] }
  | { readonly type: 'networkQuality'; readonly entries: readonly { uid: string; level: number }[] }
  | { readonly type: 'hint'; readonly text: string }
  | { readonly type: 'setMic'; readonly on: boolean }
  | { readonly type: 'setCamera'; readonly on: boolean }
  | { readonly type: 'setMinimized'; readonly minimized: boolean }
  | { readonly type: 'dismiss' };

/** reduceCallView 是视图模型的唯一入口。 */
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
        participants: [newParticipant(action.caller, true)],
        self: { micOn: true, cameraOn: action.mediaType === 'video' },
      };

    case 'callPlaced':
      return {
        ...initialCallView,
        phase: 'outgoing',
        mediaType: action.mediaType,
        isGroup: action.isGroup,
        role: 'caller',
        peerUid: action.isGroup ? '' : (action.calleeIds[0] ?? ''),
        // 呼出时对方还没接——**先摆上去且标成未接听**，界面才有「正在响铃」的格子。
        participants: action.calleeIds.map((uid) => newParticipant(uid, false)),
        self: { micOn: true, cameraOn: action.mediaType === 'video' },
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
        self: { micOn: true, cameraOn: true },
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

        # 还在响铃的来电直接收起，不留结束画面

        被叫这一侧什么都还没做，界面上只有一个来电浮层。对方取消 / 自己拒接 /
        振铃超时之后，**该做的就是让它消失**——原先统一进 ended，
        而 ended 又落到 ActiveCall 上，于是来电浮层当场变成通话页
        （静音 / 关摄像头 / 小窗 / 挂断那一排全出来了），停一两秒再收走。
        实测反馈：「为何还弹出一个那个接通才有的界面」。

        主叫那一侧不一样：拨出去没打通，人需要知道为什么（对方拒接 / 无人接听 /
        不在线），所以那边仍然停一下说明原因。
      */
      if (state.phase === 'incoming') return initialCallView;
      return { ...state, phase: 'ended', endReason: action.reason, isMinimized: false };

    case 'localCamera':
      return { ...state, localCameraCid: action.cid };

    case 'dismiss':
      return initialCallView;

    case 'userEnter':
      return withParticipant(state, action.uid, (p) => ({ ...p, hasAccepted: true }));

    case 'userLeave':
      return { ...state, participants: state.participants.filter((p) => p.uid !== action.uid) };

    /*
      群通话里某人拒接 / 没接：**把他的格子收掉**。

      不收的话那一格会一直挂着「（响铃中）」——从主叫的角度看，
      拒接就跟没发生过一样。**这在群通话里是唯一的信号**：那边没有便利事件
      （不变量 I7），只有 onUser*。1v1 也会抛，但紧跟着就是 callEnd，
      界面整个收走，收不收格子都一样。
    */
    case 'userSettled':
      return { ...state, participants: state.participants.filter((p) => p.uid !== action.uid) };

    case 'userAccept':
      return withParticipant(state, action.uid, (p) => ({ ...p, hasAccepted: true }));

    case 'userAudio':
      return withParticipant(state, action.uid, (p) => ({ ...p, hasAudio: action.available }));

    case 'userVideo':
      return withParticipant(state, action.uid, (p) => ({ ...p, hasVideo: action.available }));

    case 'activeSpeakers':
      return applySpeakers(state, action.speakers);

    case 'networkQuality':
      return applyNetwork(state, action.entries);

    case 'hint':
      return { ...state, hint: action.text };

    case 'setMic':
      return { ...state, self: { ...state.self, micOn: action.on } };

    case 'setCamera':
      return { ...state, self: { ...state.self, cameraOn: action.on } };

    case 'setMinimized':
      return { ...state, isMinimized: action.minimized };

    default:
      return state;
  }
}

function newParticipant(uid: string, hasAccepted: boolean): RemoteParticipant {
  return {
    uid,
    // **默认认为有音频**：`userAudioAvailable` 只在状态**变化**时才抛，
    // 一开始就正常的人不会有事件——默认 false 的话所有人都显示成静音。
    hasAudio: true,
    hasVideo: false,
    isSpeaking: false,
    volume: 0,
    hasAccepted,
    networkLevel: 0,
  };
}

/** withParticipant 更新一个成员；不存在时先补进来（事件比进房通知先到是常态）。 */
function withParticipant(
  state: CallViewState,
  uid: string,
  update: (p: RemoteParticipant) => RemoteParticipant,
): CallViewState {
  const found = state.participants.some((p) => p.uid === uid);
  const list = found ? state.participants : [...state.participants, newParticipant(uid, true)];
  return { ...state, participants: list.map((p) => (p.uid === uid ? update(p) : p)) };
}

/**
 * applySpeakers 把主讲人列表叠加到成员上。
 *
 * **不在名单里的人要被清成「没在说话」**：`activeSpeakers` 是全量快照而不是增量，
 * 只加不减的话高亮会一直亮着不灭。
 */
function applySpeakers(
  state: CallViewState,
  speakers: readonly { uid: string; volume: number }[],
): CallViewState {
  const volumes = new Map(speakers.map((s) => [s.uid, s.volume]));
  return {
    ...state,
    participants: state.participants.map((p) => {
      const volume = volumes.get(p.uid);
      return { ...p, isSpeaking: volume !== undefined, volume: volume ?? 0 };
    }),
  };
}

function applyNetwork(
  state: CallViewState,
  entries: readonly { uid: string; level: number }[],
): CallViewState {
  const levels = new Map(entries.map((e) => [e.uid, e.level]));
  return {
    ...state,
    participants: state.participants.map((p) => {
      const level = levels.get(p.uid);
      return level === undefined ? p : { ...p, networkLevel: level };
    }),
  };
}

/** isCallVisible 判断此刻界面上该不该有通话 UI。 */
export function isCallVisible(state: CallViewState): boolean {
  return state.phase !== 'idle';
}
