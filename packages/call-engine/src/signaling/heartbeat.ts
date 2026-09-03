import { logger } from '../logger.js';

/**
 * 心跳（RTC_PROTOCOL.md §1.3）。
 *
 * **判活条件是「收到对端任何一帧」，不是「pong 回来了」**——服务端发的任何帧
 * 都证明它还活着。所以 `noteFrameReceived()` 由读循环无差别调用。
 *
 * 从 Connection 里拆出来是为了体量红线（CONVENTIONS §2），
 * 顺带让「连续 3 个周期没动静就判死」这条规则有了独立的测试面。
 */

/** MISS_LIMIT 是判死前允许连续静默的周期数（§1.3：3 个周期 = 45 秒）。 */
export const MISS_LIMIT = 3;

/** HeartbeatCallbacks 是心跳的两个出口。 */
export interface HeartbeatCallbacks {
  /** 该发一个 sys.ping 了。 */
  sendPing: () => void;
  /** 连续静默超限，连接该判死了。 */
  onDead: () => void;
}

/** Heartbeat 管理 ping 定时器与静默计数。 */
export class Heartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  private missed = 0;

  constructor(private readonly callbacks: HeartbeatCallbacks) {}

  /** start 按服务端下发的间隔起心跳。重复调用会先停掉旧的。 */
  start(intervalSec: number): void {
    this.stop();
    this.missed = 0;
    const intervalMs = Math.max(1, intervalSec) * 1000;

    this.timer = setInterval(() => {
      this.missed += 1;
      if (this.missed > MISS_LIMIT) {
        logger.warn('心跳超时，判定连接已死', { missed: this.missed });
        this.callbacks.onDead();
        return;
      }
      this.callbacks.sendPing();
    }, intervalMs);
  }

  /** noteFrameReceived 由读循环无差别调用：收到任何帧都算对端活着。 */
  noteFrameReceived(): void {
    this.missed = 0;
  }

  /** stop 停掉心跳。幂等。 */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** missedBeats 供测试与诊断观察。 */
  get missedBeats(): number {
    return this.missed;
  }
}
