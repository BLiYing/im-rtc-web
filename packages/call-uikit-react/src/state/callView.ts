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
  role: '',
  peerUid: '',
  participants: [],
  self: { micOn: true, cameraOn: false },
  isMinimized: false,
  beganAtMs: 0,
  endReason: '',
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

    case 'mediaReady': {
      const ready = { ...state, isMediaReady: true };
      return state.phase === 'connecting' ? { ...ready, phase: 'active' } : ready;
    }

    case 'callEnd':
      // **唯一的结束出口**。停在 ended 让界面能显示 1.5 秒再自己 dismiss。
      return { ...state, phase: 'ended', endReason: action.reason, isMinimized: false };

    case 'dismiss':
      return initialCallView;

    case 'userEnter':
      return withParticipant(state, action.uid, (p) => ({ ...p, hasAccepted: true }));

    case 'userLeave':
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
