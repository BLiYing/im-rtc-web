import type { CallEndReasonValue } from './reasons.js';
import type { MediaType } from './signaling/enums.js';

/**
 * Engine 公开事件表 —— 对应设计文档 §7.5 的回调总表。
 *
 * **事件名三端同名**（CONVENTIONS §4）。这张表就是「只引 SDK 自画 UI」那条路的全部内容：
 * uikit 不是特权组件，它只消费这张表，没有任何私有通道。
 * 一旦某个界面需要 engine 开私有口子，说明表少了一项——**补表，不开后门**。
 */

/** CallRoleName 是本端在通话里的角色。 */
export type CallRoleName = 'caller' | 'callee' | '';

/** EngineEvents 是全部公开事件。参数用 TS 惯用的 camelCase。 */
export interface EngineEvents {
  // ── 连接 ────────────────────────────────────────────────
  connected: { sessionId: string; resumed: boolean };
  /**
   * 信令连接断开。
   *
   * **两个字段都一定有**：这个事件只由连接层抛，而关闭码与「会不会自己回来」
   * 都是它当场就知道的。（状态机内部也有一份 `onDisconnected`，但那份只用来
   * 驱动状态迁移、不往宿主发——见 frameLoop.ts 的 dispatch。）
   *
   * `code === 4401` 是宿主唯一需要特殊处理的一个：换新票再来（协议 §1.5），
   * 见 `updateToken`。
   */
  disconnected: { code: number; willReconnect: boolean };
  /** 同账号同设备号在别处登录。**不会自动重连**。 */
  kickedOut: Record<string, never>;
  error: { code: number; name: string; message: string };

  // ── 来电与拨出 ──────────────────────────────────────────
  callReceived: {
    callId: string;
    caller: string;
    /**
     * 这通电话邀了谁（不含主叫，**含自己**）。
     *
     * 群通话的界面靠它把还没接的人先摆成占位格——否则主叫那边是四格、
     * 被叫这边只有两格，同一通电话两种样子。
     */
    calleeIds: string[];
    mediaType: MediaType;
    isGroup: boolean;
  };
  /** 接通。**主被叫都抛**，此刻开始计时。 */
  callBegin: {
    callId: string;
    roomId: string;
    mediaType: MediaType;
    isGroup: boolean;
    role: CallRoleName;
  };
  /** **所有结束分支的唯一出口**。只监听它也能完整记录一通电话。 */
  callEnd: {
    callId: string;
    reason: CallEndReasonValue;
    durationSec: number;
    endedBy: string;
  };
  /** 以下四个是**便利事件**，只在 1v1 抛；随后必有 callEnd。 */
  callCancelled: { by: string };
  callRejected: { uid: string };
  callBusy: { uid: string };
  callNoAnswer: { uid: string };
  /**
   * **通话中**有人打进来，服务端已经替你回了忙线——这一通你不会振铃。
   *
   * MVP 是单通道：同一时刻只有一通电话（协议 §4.3 的忙线分支）。这条事件只是让界面
   * 提示一句「谁来过电话」，宿主不需要做任何处理。
   */
  callMissed: { callId: string; caller: string; reason: string };
  /** 本账号另一台设备接听/拒绝了。 */
  handledOnOtherDevice: { callId: string; action: string };

  // ── 成员 ────────────────────────────────────────────────
  userEnter: { uid: string };
  userLeave: { uid: string };
  userAccept: { uid: string };
  userReject: { uid: string };
  userNoResponse: { uid: string };
  userAudioAvailable: { uid: string; available: boolean };
  userVideoAvailable: { uid: string; available: boolean };

  // ── 媒体与质量 ──────────────────────────────────────────
  /** 主讲人变化。服务端节流 300ms，**别依赖更高频率**。 */
  activeSpeakers: { speakers: { uid: string; volume: number }[] };
  /** 网络质量 0~6。服务端节流 2s。 */
  networkQuality: { entries: { uid: string; level: number }[] };
  /**
   * 某人的画面**真的开始出数据**了，UI 用来撤 loading。
   * **本地事件，没有对应的信令帧**。
   *
   * 判据是轨道 `unmute` 而不是 `ontrack`：协商完成时远端轨道还是 muted 的，
   * 那一刻撤 loading 会露出黑屏。
   */
  firstVideoFrame: { uid: string; trackId: string };
  /** 收到一条下行轨道，宿主用它挂到 <video>。 */
  remoteTrack: { trackId: string; track: MediaStreamTrack };

  // ── 房间 ────────────────────────────────────────────────
  roomJoined: { roomId: string };
  roomLeft: { roomId: string };
  roomClosed: { roomId: string; reason: string };
}

/** EngineEventName 是事件名的联合。 */
export type EngineEventName = keyof EngineEvents;

/** EngineEventHandler 是某个事件的处理函数。 */
export type EngineEventHandler<K extends EngineEventName> = (payload: EngineEvents[K]) => void;

/**
 * MACHINE_EVENT_NAMES 把状态机内部的回调名（`onXxx`）映射到公开事件名。
 *
 * 状态机产出的名字沿用协议文档与一致性向量里的 `onXxx` 写法，
 * 公开事件用 `engine.on('callReceived', …)` 这种字符串键——
 * 两边一一对应，这张表就是那座桥。
 */
export const MACHINE_EVENT_NAMES: Readonly<Record<string, EngineEventName>> = {
  onConnected: 'connected',
  onDisconnected: 'disconnected',
  onKickedOut: 'kickedOut',
  onError: 'error',
  onCallReceived: 'callReceived',
  onCallBegin: 'callBegin',
  onCallEnd: 'callEnd',
  onCallCancelled: 'callCancelled',
  onCallRejected: 'callRejected',
  onCallBusy: 'callBusy',
  onCallNoAnswer: 'callNoAnswer',
  onCallMissed: 'callMissed',
  onHandledOnOtherDevice: 'handledOnOtherDevice',
  onUserEnter: 'userEnter',
  onUserLeave: 'userLeave',
  onUserAccept: 'userAccept',
  onUserReject: 'userReject',
  onUserNoResponse: 'userNoResponse',
  onUserAudioAvailable: 'userAudioAvailable',
  onUserVideoAvailable: 'userVideoAvailable',
  onActiveSpeakers: 'activeSpeakers',
  onNetworkQuality: 'networkQuality',
  onRoomJoined: 'roomJoined',
  onRoomLeft: 'roomLeft',
  onRoomClosed: 'roomClosed',
};
