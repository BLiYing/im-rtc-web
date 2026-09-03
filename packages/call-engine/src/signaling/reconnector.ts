import { logger } from '../logger.js';
import { backoffDelayMs } from './backoff.js';

/**
 * 重连调度（RTC_PROTOCOL.md §1.4）。
 *
 * 从 Connection 里拆出来是为了体量红线（CONVENTIONS §2），也让「退避档 + 抖动 +
 * 什么时候放弃」这组规则有独立的测试面。
 *
 * **注意它不判断「该不该重连」**——那是关闭码的事（`webSocket.ts` 的
 * `shouldReconnect`）。这里只管「决定重连之后，等多久、第几次」。
 */
export class Reconnector {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;

  constructor(
    private readonly reconnect: () => Promise<void>,
    private readonly onFailed: (error: unknown) => void,
    private readonly random: () => number = Math.random,
  ) {}

  /** schedule 安排下一次重连。重复调用会取消上一次。 */
  schedule(): void {
    this.cancel();
    const delayMs = backoffDelayMs(this.attempt, this.random);
    this.attempt += 1;
    logger.info('计划重连', { attempt: this.attempt, delayMs });

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.reconnect().catch((err: unknown) => {
        this.onFailed(err);
        // 失败后继续退避——档位不重置，否则断网期间会退化成每秒重试。
        this.schedule();
      });
    }, delayMs);
  }

  /** succeeded 在一次连接成功后把退避档重置。 */
  succeeded(): void {
    this.attempt = 0;
  }

  /** cancel 取消未触发的重连。幂等。 */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** attempts 供测试与诊断观察。 */
  get attempts(): number {
    return this.attempt;
  }
}
