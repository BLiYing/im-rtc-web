/**
 * WebSocket 的最小接口。
 *
 * engine **必须能在无 DOM 的环境构造**（CONVENTIONS §1）——一致性向量与时序测试
 * 都跑在 Node 里。所以这里只声明用得到的那几个成员，测试注入假实现，
 * 浏览器里注入原生 WebSocket。
 */

/** WebSocketLike 是 engine 用到的 WebSocket 子集。 */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  onopen: (() => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** WebSocketFactory 按 URL 造一条连接。 */
export type WebSocketFactory = (url: string) => WebSocketLike;

/** WS_OPEN 是 WebSocket.OPEN 的值，避免在无 DOM 环境引用全局常量。 */
export const WS_OPEN = 1;

/** CloseCode 是协议约定的 WS 关闭码（RTC_PROTOCOL.md §1.5）。 */
export const CloseCode = {
  /** 正常关闭（客户端主动 logout）。不重连。 */
  normal: 1000,
  /** 服务端下线/重启。立即重连。 */
  goingAway: 1001,
  /** 信封非法/帧超长/协议版本不支持。**不重连**，属实现 bug。 */
  badProtocol: 4400,
  /** 未鉴权/鉴权超时/token 无效。换新 token 后重连。 */
  unauthorized: 4401,
  /** 被踢（同 uid 同 device_id 在别处登录）。**不重连**。 */
  kickedOut: 4403,
  /** 频率超限。退避加倍后重连。 */
  rateLimited: 4429,
} as const;

/**
 * shouldReconnect 按关闭码判断要不要重连。
 *
 * 4400 与 4403 **绝不重连**：前者是我们自己的实现 bug，重连只会再撞一次；
 * 后者是被踢，重连等于跟另一台设备打架。
 */
export function shouldReconnect(code: number): boolean {
  return code !== CloseCode.normal && code !== CloseCode.badProtocol && code !== CloseCode.kickedOut;
}

/** browserWebSocketFactory 是浏览器环境的默认工厂。 */
export const browserWebSocketFactory: WebSocketFactory = (url) => {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (Ctor === undefined) {
    throw new Error('当前环境没有 WebSocket；请通过 webSocketFactory 注入实现');
  }
  return new Ctor(url);
};
