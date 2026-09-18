import { OneShotTimer } from './oneShotTimer.js';

/** PROBE_MS：局域网与 4G 下 pong 都在几百毫秒内回来；3 秒没回就不是慢，是断了。与 iOS / Android 同一个数。 */
export const PROBE_MS = 3_000;

/**
 * 「连着的那条信令还活不活」：发一个 `sys.ping`，{@link PROBE_MS} 内收到**任何**下行帧就算活，否则判死。
 * 标签页回到前台、系统网络变了的时候用（见 `Connection.nudge`）。
 *
 * # 为什么要探，而不是等心跳
 *
 * 心跳要连着 3 个周期（45 秒）收不到东西才判死，而服务端的恢复窗口只有 30 秒
 * （2026-09-18 20:45 真机 OPPO：Wi-Fi 重连换了 IP，旧 socket 已死但 TCP 不吭声）。
 * 浏览器多一种：后台标签页的定时器被节流（Chrome 隐藏 5 分钟后一分钟才跑一次），
 * 心跳形同停摆，回到前台时「连着」往往是假的。
 *
 * # 为什么不是见变化就断
 *
 * 网络变化不一定伤到旧连接，切回标签页更是大多数时候连接好好的。见变化就断会白白掐掉
 * 在飞请求；探一下只多等 3 秒。
 */
export class NetworkProbe {
  private readonly timer = new OneShotTimer();
  private answered = false;

  /** armed：正在探。已经在探就不再发第二个 ping——网络来回跳时一次只探一个。 */
  get armed(): boolean {
    return this.timer.armed;
  }

  /** arm 发探测 ping，{@link PROBE_MS} 后没收到下行就回调 `onDead`。连接关闭时调用方**必须** `stop()`。 */
  arm(sendPing: () => void, onDead: () => void): void {
    if (this.timer.armed) return;
    this.answered = false;
    sendPing();
    this.timer.start(PROBE_MS, () => {
      if (!this.answered) onDead();
    });
  }

  /** noteFrameReceived 由读循环无差别调用：收到任何帧都算活，不必是那条 pong。 */
  noteFrameReceived(): void {
    this.answered = true;
  }

  /** stop 撤掉探测。幂等。 */
  stop(): void {
    this.timer.cancel();
  }
}
