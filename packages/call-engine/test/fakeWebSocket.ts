import type { WebSocketLike } from '../src/signaling/webSocket.js';

/**
 * 测试用的假 WebSocket。
 *
 * CONVENTIONS §9：**时序类行为一律写测试，别在浏览器里靠肉眼判断**。
 * 握手、心跳、重连全是时序，用假连接 + 假计时器测才看得清；
 * 在浏览器里点半天只能得到「好像连上了」。
 */
export class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  /** sent 是本端发出去的原始帧文本。 */
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  /** closedWith 记下本端主动关闭时用的码，供断言。 */
  closedWith: { code: number; reason: string } | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = { code: code ?? 1000, reason: reason ?? '' };
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '' });
  }

  /** open 模拟连接建立。 */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** receive 模拟收到一帧。 */
  receive(raw: string): void {
    this.onmessage?.({ data: raw });
  }

  /** closeFromServer 模拟对端关闭（带协议关闭码）。 */
  closeFromServer(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  /** lastFrame 返回最后发出去的帧（已解析）。 */
  lastFrame(): { type: string; req_id: string; data: Record<string, unknown> } | undefined {
    const raw = this.sent.at(-1);
    if (raw === undefined) return undefined;
    return JSON.parse(raw) as { type: string; req_id: string; data: Record<string, unknown> };
  }

  /** frames 返回全部发出去的帧（已解析）。 */
  frames(): { type: string; req_id: string; data: Record<string, unknown> }[] {
    return this.sent.map(
      (raw) => JSON.parse(raw) as { type: string; req_id: string; data: Record<string, unknown> },
    );
  }
}

/** flush 让挂起的 Promise 回调跑完（假计时器下 microtask 不受影响）。 */
export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}
