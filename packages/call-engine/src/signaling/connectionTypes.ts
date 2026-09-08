import type { Envelope } from './envelope.js';
import type { RtcError } from '../errors.js';
import type { WebSocketFactory } from './webSocket.js';

/**
 * 连接层的公开类型。
 *
 * 从 connection.ts 抽出来（CONVENTIONS §2 的 400 行红线）——那边留实现，这边留契约。
 * 公开 API 不变：connection.ts 仍然把它们原样 re-export。
 */

/** ConnectionState 是连接状态。 */
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

/** HelloOk 是握手成功后的服务端信息。 */
export interface HelloOk {
  uid: string;
  deviceId: string;
  sessionId: string;
  resumed: boolean;
  pingIntervalSec: number;
  /** 本次握手用的那张票的到期时刻（Unix 毫秒）。**0 = 未知**。 */
  tokenExpiresAtMs: number;
  limits: {
    maxFrameBytes: number;
    maxCallees: number;
    maxRoomParticipants: number;
    maxUserDataBytes: number;
    ringTimeoutSecDefault: number;
  };
}

/**
 * KickedOutReason 是被踢的原因。
 *
 * **不合并成一个「被踢」**：三种情况宿主的处置完全不同——一个该回登录页，
 * 一个该悄悄换票重来，一个该去改配置。合并的结果是宿主只能都当登录失效处理，
 * 把可以静默恢复的场景也变成了「请重新登录」，把该改配置的场景变成了让用户干瞪眼。
 */
export type KickedOutReason = 'takenOver' | 'authExpired' | 'configRejected';

/** ConnectionEvents 是连接层对外的回调。 */
export interface ConnectionEvents {
  /** 握手完成。resumed=true 表示恢复了旧会话，房间成员关系还在。 */
  onConnected?: (hello: HelloOk) => void;
  /** 连接断开。willReconnect=false 时不会再自动回来。 */
  onDisconnected?: (info: { code: number; reason: string; willReconnect: boolean }) => void;
  /**
   * 被踢，**不会自动重连**。
   *
   * reason 决定宿主该做什么，三者处置完全不同：
   * - `takenOver` —— 同账号同设备号在别处登录，或宿主主动吊销（都是 4403/1104，
   *   客户端无从区分）。**回登录页**，换票也没用。
   * - `authExpired` —— 票不被接受且连续三次都没换上（4401 用尽）。
   *   宿主应重新取一枚票再 `login`。
   * - `configRejected` —— 服务端拒绝了这次接入的**参数**（握手应答里 retryable=false
   *   的错误码：device_id 不合规、协议版本不受支持、应用被停用……）。
   *   **去改配置**——换票和重试都救不了。具体哪里不对看 `login()` 抛出的 RtcError；
   *   如果是重连期间被拒，那条码走 onError。
   */
  onKickedOut?: (info: { reason: KickedOutReason }) => void;
  /**
   * 断得太久了，**服务端那一侧的会话已经不可能再恢复**（§1.4 的恢复窗口过了）。
   *
   * 与「重连上了但 `resumed=false`」是同一件事，只是**不必等重连成功**——
   * 网络一直不回来的话那一刻永远不会到。少了它，界面就永远停在「正在重连」、
   * 连挂断都点不动（真机 2026-09-08 的 iOS 端）。
   */
  onSessionUnrecoverable?: () => void;
  /** 票快到期了，宿主该去取新票并 updateToken。见 tokenExpiry.ts。 */
  onTokenWillExpire?: (info: { expiresAtMs: number }) => void;
  /** 收到服务端主动推送的事件（req_id 为空的帧）。 */
  onEvent?: (type: string, data: Record<string, unknown>, envelope: Envelope) => void;
  /** 内部错误。 */
  onError?: (error: RtcError) => void;
}

/** ConnectionOptions 是构造参数。带 Fn 后缀的都是为了测试可注入。 */
export interface ConnectionOptions {
  url: string;
  token: string;
  deviceId: string;
  sdk?: string;
  events?: ConnectionEvents;
  webSocketFactory?: WebSocketFactory;
  /** 请求超时。协议建议 10 秒（§2.2）。 */
  requestTimeoutMs?: number;
  random?: () => number;
  /** 票到期前多久提醒宿主换票。默认 60s，见 tokenExpiry.ts。 */
  tokenExpiryLeadMs?: number;
}
