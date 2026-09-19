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

  /** closedWith 记下本端主动关闭时用的码，供断言。`code` 为 undefined = 不带状态码关闭（线上是 1005）。 */
  closedWith: { code: number | undefined; reason: string } | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  /**
   * **照浏览器的规矩校验关闭码**：客户端只许用 1000 或 3000–4999，别的一律抛 InvalidAccessError。
   * 原先这里什么码都收，于是 `close(1001)` 在单测里一路绿，到了真浏览器里每次都抛——
   * 心跳 / 探测判死从来没真正关掉过连接（2026-09-19 真机）。
   */
  close(code?: number, reason?: string): void {
    if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) {
      throw new DOMException(
        `Failed to execute 'close' on 'WebSocket': The close code must be either 1000, or between 3000 and 4999. ${code} is neither.`,
        'InvalidAccessError',
      );
    }
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = { code, reason: reason ?? '' };
    this.onclose?.({ code: code ?? 1005, reason: reason ?? '' });
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
