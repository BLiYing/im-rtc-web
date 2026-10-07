import type { EngineEvents } from 'im-rtc-call-engine';
import { ErrorCode, isRtcError, logger } from 'im-rtc-call-engine';

/**
 * Kit 取票登录（server `docs/design/KIT_TOKEN_PROVIDER_DESIGN.md`）。
 *
 * **Engine 仍是 push**（`updateToken`，RTC_CALL_DESIGN §7.5 的决定不变），**Kit 来 pull**：
 * 宿主只给「怎么从自家后台取一张票」，何时取、失败了怎么重来、拨号前补登录都归这里。
 * 不配 `tokenProvider` 时整套不启用，行为与 2.1.x 一致。
 *
 * 纯逻辑、不碰 React，计时与联网判断都注入——单测直接驱动（`test/kitSession.test.ts`）。
 */

/** KitToken 是宿主取回来的一张票。`expiresAtMs` 不知道就不填，engine 会从 `sys.hello.ok` 拿权威值。 */
export interface KitToken {
  readonly token: string;
  readonly expiresAtMs?: number;
}

/** TokenProvider 是宿主「从自家后台取一张 RTC 票」的那一下。失败就 reject。 */
export type TokenProvider = () => Promise<KitToken>;

/** 登不上时给用户的话分两类（设计 §5）：`network` 让人查网络，`service` 让人稍后再试。 */
export type FailureKind = 'network' | 'service';

/** SessionEngine 是会话用到的那一小片 engine。 */
export interface SessionEngine {
  login(token: string): Promise<unknown>;
  logout(): void;
  updateToken(token: string, expiresAtMs?: number): void;
  notifyNetworkChanged(): void;
}

export interface SessionDeps {
  readonly engine: SessionEngine;
  readonly provider: TokenProvider;
  /** 排一个定时任务，返回撤销函数。 */
  readonly schedule: (delayMs: number, task: () => void) => () => void;
  /** 设备此刻有没有网。分不清宿主取票为什么失败时，靠它挑文案。 */
  readonly isOnline: () => boolean;
}

export type SessionPhase = 'idle' | 'connecting' | 'ready' | 'waiting' | 'halted';

/** 失败后的退避（设计 §4）：封顶 60 s，不设次数上限，成功即归零。 */
export const RETRY_BACKOFF_MS: readonly number[] = [2000, 4000, 8000, 16000, 32000, 60000];
/** `ensure()` 最多等多久。超时按 `network` 算。 */
export const ENSURE_TIMEOUT_MS = 10000;

type Waiter = (failure: FailureKind | null) => void;
type KickedOutReason = EngineEvents['kickedOut']['reason'];

/** 登录失败的码归到哪一类：连不上 / 超时是网络，其余看设备有没有网。 */
function loginFailureKind(err: unknown, online: boolean): FailureKind {
  const code = isRtcError(err) ? err.code : null;
  if (code === ErrorCode.networkUnreachable || code === ErrorCode.signalingTimeout) return 'network';
  return online ? 'service' : 'network';
}

export class KitSession {
  private phase: SessionPhase = 'idle';
  /** 代际：每轮尝试、每次停止都换代，迟到的回调认得出自己作废了。 */
  private generation = 0;
  private failures = 0;
  /** 顶号 / 配置被拒：不自动重试，直到下一次登录成功或重新启动。 */
  private haltedByKick = false;
  private connected = false;
  private cancelRetry: (() => void) | null = null;
  /** 等这一轮尝试出结论的。 */
  private attemptWaiters: Waiter[] = [];
  /** 已登录、正在重连，等 `connected` 的。 */
  private reconnectWaiters: Waiter[] = [];

  constructor(private readonly deps: SessionDeps) {}

  get currentPhase(): SessionPhase {
    return this.phase;
  }

  start(): void {
    if (this.phase !== 'idle') return;
    this.attempt();
  }

  /** stop：在途的取票 / 登录回来一律作废，等待者都按失败结掉，engine 登出。 */
  stop(): void {
    if (this.phase === 'idle') return;
    this.generation += 1;
    this.clearRetry();
    this.phase = 'idle';
    this.connected = false;
    this.haltedByKick = false;
    this.failures = 0;
    this.settle('attempt', 'service');
    this.settle('reconnect', 'service');
    this.deps.engine.logout();
  }

  /**
   * ensure 确保已登录：`null` = 可以用了，否则是失败类别。
   * 拨号、加入、宿主查通话记录之前调。**同一时刻只有一轮尝试**，多处调用共用它。
   */
  ensure(): Promise<FailureKind | null> {
    switch (this.phase) {
      case 'idle':
        return Promise.resolve('service');
      case 'ready':
        if (this.connected) return Promise.resolve(null);
        // 登上过、正在重连：叫 engine 别按退避等了，立刻连，然后等 `connected`。
        this.deps.engine.notifyNetworkChanged();
        return this.wait(this.reconnectWaiters);
      case 'connecting':
        return this.wait(this.attemptWaiters);
      case 'waiting':
      case 'halted': {
        // halted 也试：这是用户亲手点的，代价是一次请求（设计 §4）。先排队再尝试，与 iOS / Android 同序。
        const waiting = this.wait(this.attemptWaiters);
        this.attempt();
        return waiting;
      }
    }
  }

  onConnected(): void {
    this.connected = true;
    if (this.phase === 'ready') this.settle('reconnect', null);
  }

  onDisconnected(): void {
    this.connected = false;
  }

  onKickedOut(reason: KickedOutReason): void {
    this.connected = false;
    if (this.phase === 'idle') return;
    if (reason === 'authExpired') {
      // 票的问题：取一张新票重登。engine 已经放弃这条连接，先登出再来。
      logger.info('[uikit] 票失效被踢，重新取票登录');
      this.haltedByKick = false;
      this.deps.engine.logout();
      this.attempt();
      return;
    }
    // 顶号该回登录页、配置错了重试也没用——都不自动重来（宿主照常收到 kickedOut）。
    logger.warn('[uikit] 被踢下线，不再自动登录', { reason });
    this.haltedByKick = true;
    this.clearRetry();
    if (this.phase === 'ready' || this.phase === 'waiting') this.phase = 'halted';
    this.settle('reconnect', 'service');
  }

  /** 票快过期：取新票交给 engine（下次重连生效）。取不到只记日志，降级成 4401 → authExpired 那条路。 */
  onTokenWillExpire(): void {
    if (this.phase !== 'ready') return;
    const generation = this.generation;
    this.deps.provider().then(
      (ticket) => {
        if (generation !== this.generation || ticket.token === '') return;
        this.deps.engine.updateToken(ticket.token, ticket.expiresAtMs);
        logger.info('[uikit] 已续票');
      },
      (err: unknown) => logger.warn('[uikit] 续票时取票失败', { err: String(err) }),
    );
  }

  /** 网络恢复 / 回到前台：在退避里等着的立刻再试。 */
  onNetworkRestored(): void {
    if (this.phase === 'waiting') this.attempt();
  }

  private attempt(): void {
    this.clearRetry();
    this.generation += 1;
    this.phase = 'connecting';
    void this.run(this.generation);
  }

  private async run(generation: number): Promise<void> {
    let ticket: KitToken;
    try {
      ticket = await this.deps.provider();
    } catch (err) {
      if (generation !== this.generation) return;
      logger.warn('[uikit] 取票失败', { err: String(err) });
      this.fail(this.deps.isOnline() ? 'service' : 'network');
      return;
    }
    if (generation !== this.generation) return;
    if (ticket.token === '') {
      logger.warn('[uikit] 取票返回空票');
      this.fail('service');
      return;
    }
    // 清掉任何半截状态（上一轮没收干净的连接）；没登录时是空操作。
    this.deps.engine.logout();
    try {
      await this.deps.engine.login(ticket.token);
    } catch (err) {
      if (generation !== this.generation) return;
      logger.warn('[uikit] 登录失败', { code: isRtcError(err) ? err.code : null, err: String(err) });
      // Kit 是唯一的重试者：不收的话 engine 自己的重连会和这里的退避打架。
      this.deps.engine.logout();
      this.fail(loginFailureKind(err, this.deps.isOnline()));
      return;
    }
    if (generation !== this.generation) return;
    this.phase = 'ready';
    this.connected = true;
    this.failures = 0;
    this.haltedByKick = false;
    logger.info('[uikit] 已登录');
    this.settle('attempt', null);
  }

  private fail(kind: FailureKind): void {
    this.settle('attempt', kind);
    if (this.haltedByKick) {
      this.phase = 'halted';
      return;
    }
    this.phase = 'waiting';
    const delay = RETRY_BACKOFF_MS[Math.min(this.failures, RETRY_BACKOFF_MS.length - 1)] ?? 60000;
    this.failures += 1;
    const generation = this.generation;
    this.cancelRetry = this.deps.schedule(delay, () => {
      this.cancelRetry = null;
      if (generation === this.generation && this.phase === 'waiting') this.attempt();
    });
  }

  private clearRetry(): void {
    this.cancelRetry?.();
    this.cancelRetry = null;
  }

  /** wait 排进一张等待表，最多等 {@link ENSURE_TIMEOUT_MS}。 */
  private wait(list: Waiter[]): Promise<FailureKind | null> {
    return new Promise((resolve) => {
      let done = false;
      const cancelTimeout = this.deps.schedule(ENSURE_TIMEOUT_MS, () => finish('network'));
      const finish: Waiter = (failure) => {
        if (done) return;
        done = true;
        cancelTimeout();
        const index = list.indexOf(finish);
        if (index >= 0) list.splice(index, 1);
        resolve(failure);
      };
      list.push(finish);
    });
  }

  private settle(which: 'attempt' | 'reconnect', failure: FailureKind | null): void {
    const list = which === 'attempt' ? this.attemptWaiters : this.reconnectWaiters;
    for (const waiter of [...list]) waiter(failure);
    list.length = 0;
  }
}
