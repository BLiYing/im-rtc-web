import type { IMLogEntryLike } from './logTypes.js';

/**
 * 把 engine 的日志送回服务端落盘。
 *
 * # 为什么需要
 *
 * 客户端的事件流与日志只活在浏览器控制台里。要分析一次问题就得让人手动复制粘贴——
 * 复制不全、顺序错乱、跟服务端日志对不上时间轴，排查一次要来回好几轮。
 * 送回服务端之后，一次通话的**两端加服务端**就能按时间轴放在一起读。
 *
 * # 边界
 *
 * 这是 **Demo 的东西，不是 SDK 的**。SDK 只提供 `setLogSink` 这个接缝；
 * 「日志送到哪里去」永远是宿主的决定。服务端那个接收口也只在开发模式下存在。
 */

/** RemoteLogSink 攒批上报，避免每条日志一个请求。 */
export class RemoteLogSink {
  private queue: IMLogEntryLike[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(
    private readonly server: string,
    private readonly client: string,
    /** 攒批间隔。1 秒足够——排查时不会在意这一秒的延迟。 */
    private readonly flushIntervalMs = 1_000,
    /** 队列上限。满了丢**最旧**的：正在排查的问题总在最近这几条里。 */
    private readonly maxQueue = 500,
  ) {}

  /** start 开始定时上报，并在页面关闭时抢救最后一批。 */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    // 关标签页时最后一批往往正是最要紧的那批（比如崩溃前的几条）。
    window.addEventListener('pagehide', () => void this.flush(true));
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    void this.flush(true);
  }

  /** push 记一条。**这里绝不能抛异常**——日志失败不该影响业务。 */
  push(entry: IMLogEntryLike): void {
    this.queue.push(entry);
    if (this.queue.length > this.maxQueue) {
      this.queue.splice(0, this.queue.length - this.maxQueue);
    }
  }

  private async flush(final = false): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, 200);

    try {
      await fetch(`${this.server}/v1/dev/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: this.client, entries: batch }),
        // keepalive 让 pagehide 时那一批也能发出去。
        keepalive: final,
      });
    } catch {
      // 上报失败就把这批放回去重试；**唯独最后一批不放**——
      // 页面都要关了，放回去只会让 flush 永远排队。
      if (!final) this.queue.unshift(...batch);
    } finally {
      this.flushing = false;
    }
  }
}
