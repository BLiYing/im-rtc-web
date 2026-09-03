import { ErrorCode, RtcError } from '../errors.js';
import type { Envelope } from './envelope.js';

/**
 * 在途请求表：**按 `req_id` 配对，不按帧类型**。
 *
 * pub 侧的 `room.offer` 是由 **`room.answer`** 应答的（协议 §3.3 固定 offerer），
 * 只看类型对不上号；按 req_id 配对还顺带解决了「多个同类请求在途」的问题。
 */

/** RequestResult 是一次请求的应答。 */
export interface RequestResult {
  readonly envelope: Envelope;
  readonly data: Record<string, unknown>;
}

interface Waiter {
  resolve: (value: RequestResult) => void;
  reject: (reason: RtcError) => void;
  timer: ReturnType<typeof setTimeout>;
  type: string;
}

/** PendingRequests 管理在途请求与它们的超时。 */
export class PendingRequests {
  private readonly waiters = new Map<string, Waiter>();

  constructor(private readonly timeoutMs: number) {}

  /** track 登记一个在途请求，返回它的 Promise。 */
  track(reqId: string, type: string): Promise<RequestResult> {
    return new Promise<RequestResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(reqId);
        reject(new RtcError(ErrorCode.signalingTimeout, { forType: type }));
      }, this.timeoutMs);
      this.waiters.set(reqId, { resolve, reject, timer, type });
    });
  }

  /** abandon 撤掉一个还没发出去就失败的请求。 */
  abandon(reqId: string): void {
    const waiter = this.waiters.get(reqId);
    if (waiter === undefined) return;
    clearTimeout(waiter.timer);
    this.waiters.delete(reqId);
  }

  /**
   * settle 用一帧应答结算在途请求。
   * 返回 false 表示这个 req_id 没人在等——调用方应当把它当事件处理。
   */
  settle(envelope: Envelope, decode: (env: Envelope) => Record<string, unknown>): boolean {
    const waiter = this.waiters.get(envelope.reqId);
    if (waiter === undefined) return false;
    this.waiters.delete(envelope.reqId);
    clearTimeout(waiter.timer);

    if (envelope.type === 'sys.error') {
      const code = envelope.data['code'];
      const forType = envelope.data['for_type'];
      waiter.reject(
        new RtcError(typeof code === 'number' ? code : ErrorCode.internal, {
          forType: typeof forType === 'string' ? forType : waiter.type,
        }),
      );
      return true;
    }
    waiter.resolve({ envelope, data: decode(envelope) });
    return true;
  }

  /** rejectAll 在断线时把全部在途请求失败掉——它们的应答永远不会来了。 */
  rejectAll(error: RtcError): void {
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  /** size 供测试与诊断观察。 */
  get size(): number {
    return this.waiters.size;
  }
}
