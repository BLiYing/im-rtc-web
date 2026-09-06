import type { CallEndReasonValue, CallRoleName, MediaType } from '@im-rtc/call-engine';

/**
 * 通话界面视图模型的**类型与初始值**。reducer 在 `callView.ts`，成员相关的叠加在 `participants.ts`。
 *
 * 拆成三个文件是体量红线（CONVENTIONS §2）逼出来的，边界按「谁改它」划：
 * 类型改得最少、reducer 改得最多。
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

/**
 * SettledOutcome 是邀请中的成员给出的终局：拒了 / 没接 / 不在线。
 * 空串 = 还没有终局。有终局的格子停 2s 再移除（交互稿 §05 G3）。
 */
export type SettledOutcome = '' | 'rejected' | 'no_answer' | 'offline';

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
  /** 邀请中的格子拿到的终局；见 `SettledOutcome`。 */
  readonly settled: SettledOutcome;
}

/** SelfState 是本端的开关状态。 */
export interface SelfState {
  readonly micOn: boolean;
  readonly cameraOn: boolean;
  /**
   * 摄像头权限被拒（或没有设备）。**通话继续，只是没有画面**（交互稿 §02 P3）：
   * 摄像头按钮变禁用态写「无权限」。
   */
  readonly cameraBlocked: boolean;
}

/** ConnectionStatus 是信令连接的状态，驱动顶部的橙条。 */
export type ConnectionStatus = 'ok' | 'reconnecting' | 'lost';

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
   */
  readonly isMeeting: boolean;
  readonly role: CallRoleName;
  /** 1v1 的对端 uid；群通话为空串。 */
  readonly peerUid: string;
  readonly participants: readonly RemoteParticipant[];
  readonly self: SelfState;
  /** 是否收进小窗。 */
  readonly isMinimized: boolean;
  /**
   * 1v1 视频里两块画面是否互换了（交互稿 §04）：false = 远端全屏、本端小窗。
   * **纯本端行为**，不发任何帧；但层上界要跟着换。
   */
  readonly isSwapped: boolean;
  /** 接通时刻（`Date.now()`），0 = 还没接通。计时器从它开始走。 */
  readonly beganAtMs: number;
  readonly endReason: CallEndReasonValue | '';
  /**
   * 结束时的通话时长，**由服务端给**（`call.ended.duration_sec`）。
   *
   * 不变量 I8：四端禁止自己算时长（时钟偏移）。结束画面原先拿 `Date.now() - beganAtMs`
   * 现算，与另外两端各算各的。
   */
  readonly endedDurationSec: number;
  /**
   * 本端摄像头轨道的 cid，空串 = 还没起摄像头。
   *
   * **进 state 是因为它决定渲染**：本端格子要显示画面还是头像，全看它有没有。
   */
  readonly localCameraCid: string;
  /** 一句给用户看的提示（「对方已拒接」这类）。 */
  readonly hint: string;
  /**
   * 媒体是否已经就绪。
   *
   * **单独记一个标志而不是只看阶段**：`callBegin` 与「媒体通了」谁先到都可能——
   * 先到的那个如果只在「阶段正好是 connecting」时才生效，就会被丢掉。
   */
  readonly isMediaReady: boolean;
  readonly connection: ConnectionStatus;
  /**
   * 还能不能加人。主叫默认能；收到 `1407 not_call_owner` 后关掉——
   * 正常情况下非主叫根本看不到按钮，这条是兜底。
   */
  readonly canInvite: boolean;
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
  self: { micOn: true, cameraOn: false, cameraBlocked: false },
  isMinimized: false,
  isSwapped: false,
  beganAtMs: 0,
  endReason: '',
  endedDurationSec: 0,
  localCameraCid: '',
  hint: '',
  isMediaReady: false,
  connection: 'ok',
  canInvite: true,
};

/**
 * ViewAction 是驱动视图模型的输入。
 *
 * 分成两类：来自事件表的，与用户在界面上的动作。
 * **写成显式联合而不是把 EngineEvents 映射过来**：映射过来会把 uikit
 * 不消费的事件也拖进类型里，看不出「界面到底用了哪几个事件」。
 */
export type ViewAction =
  | { readonly type: 'callReceived'; readonly callId: string; readonly caller: string;
      /** 这通电话邀了谁，**已去掉自己**。群通话靠它摆占位格。 */
      readonly calleeIds: readonly string[];
      readonly mediaType: MediaType; readonly isGroup: boolean }
  | { readonly type: 'callPlaced'; readonly calleeIds: readonly string[];
      readonly mediaType: MediaType; readonly isGroup: boolean }
  | { readonly type: 'callBegin'; readonly callId: string; readonly roomId: string;
      readonly mediaType: MediaType; readonly isGroup: boolean; readonly role: CallRoleName;
      readonly nowMs: number }
  | { readonly type: 'callEnd'; readonly reason: CallEndReasonValue; readonly durationSec: number }
  | { readonly type: 'localCamera'; readonly cid: string }
  /** 摄像头拿不到（权限被拒 / 没设备）：通话继续，按钮禁用。 */
  | { readonly type: 'cameraBlocked' }
  /** 主叫往群通话里又拉了一批人，先摆上占位格。 */
  | { readonly type: 'invited'; readonly uids: readonly string[] }
  /** 某人给出了终局裁决（拒接 / 无应答 / 不在线），格子先标上终局、稍后再收。 */
  | { readonly type: 'userSettled'; readonly uid: string; readonly outcome: SettledOutcome }
  /** 终局停够了，把格子收掉。 */
  | { readonly type: 'userRemove'; readonly uid: string }
  /** 服务端说不是主叫（1407）：藏掉加人入口。 */
  | { readonly type: 'inviteDenied' }
  | { readonly type: 'meetingJoined'; readonly roomId: string; readonly nowMs: number }
  | { readonly type: 'roomLeft' }
  | { readonly type: 'mediaReady' }
  | { readonly type: 'connection'; readonly status: ConnectionStatus }
  | { readonly type: 'userEnter'; readonly uid: string }
  | { readonly type: 'userLeave'; readonly uid: string }
  | { readonly type: 'userAccept'; readonly uid: string }
  | { readonly type: 'userAudio'; readonly uid: string; readonly available: boolean }
  | { readonly type: 'userVideo'; readonly uid: string; readonly available: boolean }
  | { readonly type: 'activeSpeakers'; readonly speakers: readonly { uid: string; volume: number }[] }
  | { readonly type: 'networkQuality'; readonly entries: readonly { uid: string; level: number }[] }
  | { readonly type: 'hint'; readonly text: string }
  /** 提示到点了自己消失。带 text 是为了**只清掉自己那条**，不误伤后来的提示。 */
  | { readonly type: 'hintExpired'; readonly text: string }
  | { readonly type: 'setMic'; readonly on: boolean }
  | { readonly type: 'setCamera'; readonly on: boolean }
  | { readonly type: 'setMinimized'; readonly minimized: boolean }
  | { readonly type: 'setSwapped'; readonly swapped: boolean }
  | { readonly type: 'dismiss' };
