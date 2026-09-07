/**
 * 接入票到期前的主动换票定时器。
 *
 * # 为什么需要它
 *
 * 服务端只在 `sys.hello` 握手时验一次票，之后永不复查。所以票过期**不会**断开已建立的
 * 连接——真正出问题的时刻是**过期之后的第一次重连**：那一次握手撞上 `4401`，
 * 按退避档重试三次，然后 `kickedOut`，用户被踢回登录页。
 *
 * 而这条路径是**被动**的：用户先经历一次掉线加三轮重试，宿主才知道要换票。
 * 有了 `sys.hello.ok` 下发的 `token_expires_at_ms`，我们可以在到期**前**提醒宿主，
 * 让它静默换票，用户全程无感。
 *
 * 见 im-rtc-server/docs/design/TOKEN_LIFECYCLE_DESIGN.md §6-①②。
 *
 * # 为什么单独一个模块
 *
 * 它是纯逻辑（时刻计算 + 一个定时器），可以脱离 WebSocket 直接单测；
 * 而 connection.ts 已经贴着 400 行的体量红线（CONVENTIONS §2）。
 */

/** TimerHandle 是宿主环境的定时器句柄。Node 与浏览器的类型不同，这里不关心具体是什么。 */
export type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * DEFAULT_LEAD_MS 是提前量：到期前多久提醒宿主换票。
 *
 * 60 秒的依据是「够宿主打一次自家后台的换票接口，且不至于早到让宿主觉得莫名其妙」。
 * 比这个再短的话，一次慢请求就跨过了到期时刻。
 */
export const DEFAULT_LEAD_MS = 60_000;

/** TokenExpiryOptions 是构造参数。带 Fn 的都是为了测试可注入。 */
export interface TokenExpiryOptions {
  /** 到期前多久触发。默认 {@link DEFAULT_LEAD_MS}。 */
  leadMs?: number;
  /** 触发时调它。**同一张票只会触发一次**。 */
  onWillExpire: (info: { expiresAtMs: number }) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

/**
 * TokenExpiryTimer 盯着当前这张票的到期时刻，在到期前触发一次提醒。
 *
 * 生命周期：每次握手成功 `arm(hello.tokenExpiresAtMs)`；宿主换票后
 * `arm(newExpiresAtMs)` 重新武装；连接关闭 `disarm()`。
 */
export class TokenExpiryTimer {
  private handle: TimerHandle | null = null;
  private readonly leadMs: number;
  private readonly onWillExpire: (info: { expiresAtMs: number }) => void;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;

  constructor(options: TokenExpiryOptions) {
    this.leadMs = options.leadMs ?? DEFAULT_LEAD_MS;
    this.onWillExpire = options.onWillExpire;
    this.now = options.now ?? ((): number => Date.now());
    this.setTimer = options.setTimer ?? ((fn, ms): TimerHandle => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle): void => clearTimeout(handle));
  }

  /**
   * arm 按新的到期时刻重新武装。
   *
   * - `expiresAtMs <= 0` = 服务端说「未知」（协议 §1.2）→ **解除武装，不报错**。
   *   这条路径退化成打这个补丁之前的被动行为，是刻意的降级而不是故障。
   * - 已经进入提前量窗口（含已过期）→ **立刻触发一次**，而不是静默跳过。
   *   票只剩 10 秒时更需要提醒宿主，不是更不需要。
   */
  arm(expiresAtMs: number): void {
    this.disarm();
    if (expiresAtMs <= 0) return;

    const delay = expiresAtMs - this.leadMs - this.now();
    // 用 setTimer(…, 0) 而不是同步调用：arm 是在握手成功的路径上调的，
    // 同步回调会让宿主的 updateToken 重入到还没走完的连接流程里。
    this.handle = this.setTimer(
      () => {
        this.handle = null;
        this.onWillExpire({ expiresAtMs });
      },
      Math.max(0, delay),
    );
  }

  /** disarm 解除武装。重复调用安全。 */
  disarm(): void {
    if (this.handle === null) return;
    this.clearTimer(this.handle);
    this.handle = null;
  }

  /** isArmed 供测试与自检用。 */
  get isArmed(): boolean {
    return this.handle !== null;
  }
}
