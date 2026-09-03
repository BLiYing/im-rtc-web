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
  /** 已经彻底放弃。见 stop() —— 这是**闩**，不是一次性的取消。 */
  private stopped = false;

  constructor(
    private readonly reconnect: () => Promise<void>,
    private readonly onFailed: (error: unknown) => void,
    private readonly random: () => number = Math.random,
  ) {}

  /**
   * schedule 安排下一次重连。
   *
   * **已经排着一次就什么都不做**（不重排、不进档）。一次失败会从两条路同时走到这里：
   * `connect()` 的 promise 被拒（下面的 catch）和 socket 的 close 事件——
   * 每次都重排的话退避档一次涨两级，日志里是 `attempt=14` 紧跟着 `attempt=15`，
   * 十几分钟后就退到了几十秒一次，看着像「不重连了」。
   */
  schedule(): void {
    if (this.stopped || this.timer !== null) return;
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

  /** succeeded 在一次连接成功后把退避档重置，并解掉 stop() 的闩。 */
  succeeded(): void {
    this.attempt = 0;
    this.stopped = false;
  }

  /**
   * stop 彻底放弃重连，**并挡住之后的 schedule()**。
   *
   * 为什么不能只 `cancel()`：一次失败会从两条路走到这里，而 `connect()` 被拒的那条
   * 是**微任务**——它排在 close 事件的处理之后。只取消定时器的话，
   * 刚放弃完，那个迟到的 catch 又把重连排了回来，「不再重连」等于没生效。
   */
  stop(): void {
    this.stopped = true;
    this.cancel();
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
