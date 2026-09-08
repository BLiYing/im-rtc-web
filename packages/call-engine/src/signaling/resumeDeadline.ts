import { logger } from '../logger.js';

/** 协议 §1.4 的恢复窗口：30 秒。**四端同一个值**，服务端的 `ResumeWindow` 也是它。 */
export const RESUME_WINDOW_SEC = 30;

/** 服务端判一条连接死掉要连续几个心跳周期收不到东西（§1.3）。 */
export const SERVER_DEATH_PINGS = 3;

/** 余量：跨过服务端窗口到期那一刻再收场，别跟它抢同一秒。 */
export const GIVE_UP_GRACE_SEC = 5;

/*
 断开多久之后可以断定「服务端那一侧的会话没了」。

 # 为什么不是恢复窗口那 30 秒

 服务端的 30 秒**不是从我们断开的那一刻算起的**，是从**它自己察觉**的那一刻算起。
 而它靠读超时察觉：连续 3 个心跳周期收不到任何东西才判死（§1.3）。
 我们断开时距离上一帧最多一个心跳周期，所以最晚的到期时刻是
 `断开 + 3×ping + 30s`——按默认 15 秒心跳就是 45 + 30 = 75 秒，再加一点余量。

 # 为什么必须取上界

 取短了就会撒谎：真机 2026-09-08 实测，断开 14 秒后重连**成功恢复**，通话好端端地继续。
 在那之前宣布「通话已结束」是把一通还能救回来的电话杀掉，而且服务端还认为我们在房里，
 房间会挂着一个幽灵成员。**宁可让用户多看几十秒「正在重连」，也不能提前下结论。**
 */
export function giveUpDelayMs(pingIntervalSec: number): number {
  return (SERVER_DEATH_PINGS * pingIntervalSec + RESUME_WINDOW_SEC + GIVE_UP_GRACE_SEC) * 1000;
}

/**
 * 「服务端已经彻底放弃这条会话」的倒计时（协议 §1.4）。
 *
 * # 为什么需要它
 *
 * 客户端本地放弃的唯一入口原本是「重连上了但 `resumed=false`」——**它要求先连回来**。
 * 网络一直不回来的话那一刻永远不会到，界面就永远停在「正在重连」，
 * 而且**连挂断都点不动**（挂断只产出一帧发不出去的 `call.hangup`，
 * 本地状态按 §4.2 铁律 1 一动不动）。真机 2026-09-08 的 iOS 端就是这一幕。
 *
 * # 从 Connection 里拆出来
 *
 * 和 `Reconnector` 同一个理由：体量红线（CONVENTIONS §2），
 * 也让「什么时候该放弃」这条规则有独立的测试面。
 */
export class ResumeDeadline {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pingIntervalSec = 15;

  constructor(private readonly onUnrecoverable: () => void) {}

  /**
   * 握手成功：撤掉倒计时，并记下服务端给的心跳周期（上界要拿它推算）。
   *
   * **不管 `resumed` 是真是假都要撤** —— 服务端已经给出裁决，
   * `resumed=false` 那条自有 `handleHelloOk` 去收场，不该再由倒计时补一刀。
   */
  connected(pingIntervalSec: number): void {
    this.cancel();
    this.pingIntervalSec = pingIntervalSec;
  }

  /**
   * 起倒计时。
   *
   * **只在第一次断开时起**：每一次重连失败都会走到调用点，每次都重排的话
   * 截止时刻就一直往后挪、永远不会到——而那正是它要治的病。
   * 起点是第一次断开的那一刻，与服务端算的是同一笔账。
   */
  arm(): void {
    if (this.timer !== null) return;
    const delayMs = giveUpDelayMs(this.pingIntervalSec);
    logger.info('恢复窗口倒计时已起', { delayMs });
    this.timer = setTimeout(() => {
      this.timer = null;
      logger.warn('断开已超过恢复窗口，会话不可恢复', {});
      this.onUnrecoverable();
    }, delayMs);
  }

  /** 撤销。连上了、或宿主 logout 了都要调。幂等。 */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** armed 供测试与诊断观察。 */
  get armed(): boolean {
    return this.timer !== null;
  }
}
