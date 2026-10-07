import { ErrorCode, RtcError } from 'im-rtc-call-engine';
import { describe, expect, it } from 'vitest';

import type { KitToken, SessionEngine } from '../src/session/kitSession.js';
import { ENSURE_TIMEOUT_MS, KitSession, RETRY_BACKOFF_MS } from '../src/session/kitSession.js';

/** 手动推进的计时器：`advance(ms)` 跑掉到点的任务。 */
class ManualClock {
  now = 0;
  private tasks: { at: number; task: () => void; live: boolean }[] = [];
  schedule = (delayMs: number, task: () => void): (() => void) => {
    const entry = { at: this.now + delayMs, task, live: true };
    this.tasks.push(entry);
    return () => {
      entry.live = false;
    };
  };
  pending(): number[] {
    return this.tasks.filter((t) => t.live && t.at > this.now).map((t) => t.at - this.now);
  }
  async advance(ms: number): Promise<void> {
    this.now += ms;
    for (const entry of [...this.tasks]) {
      if (entry.live && entry.at <= this.now) {
        entry.live = false;
        entry.task();
      }
    }
    await flush();
  }
}

/** 让排在微任务里的 then 都跑完。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

class FakeSessionEngine implements SessionEngine {
  readonly log: string[] = [];
  loginError: unknown = null;
  /** 不为 null 时 login 挂起，由测试手动结掉。 */
  hold: { resolve: () => void; reject: (err: unknown) => void } | null = null;
  holdLogin = false;
  async login(token: string): Promise<unknown> {
    this.log.push(`login:${token}`);
    if (this.holdLogin) {
      return new Promise<void>((resolve, reject) => {
        this.hold = { resolve, reject };
      });
    }
    if (this.loginError !== null) throw this.loginError;
    return {};
  }
  logout(): void {
    this.log.push('logout');
  }
  updateToken(token: string, expiresAtMs?: number): void {
    this.log.push(`update:${token}:${expiresAtMs ?? ''}`);
  }
  notifyNetworkChanged(): void {
    this.log.push('nudge');
  }
  logins(): string[] {
    return this.log.filter((entry) => entry.startsWith('login:'));
  }
}

interface Rig {
  session: KitSession;
  engine: FakeSessionEngine;
  clock: ManualClock;
  provider: { calls: number; next: () => Promise<KitToken> };
  online: { value: boolean };
}

function rig(): Rig {
  const engine = new FakeSessionEngine();
  const clock = new ManualClock();
  const online = { value: true };
  const provider = {
    calls: 0,
    next: (): Promise<KitToken> => Promise.resolve({ token: `t${provider.calls}` }),
  };
  const session = new KitSession({
    engine,
    provider: () => {
      provider.calls += 1;
      return provider.next();
    },
    schedule: clock.schedule,
    isOnline: () => online.value,
  });
  return { session, engine, clock, provider, online };
}

describe('KitSession', () => {
  it('启动即取票登录；登上后 ensure 立即可用', async () => {
    const { session, engine } = rig();
    session.start();
    await flush();
    expect(engine.logins()).toEqual(['login:t1']);
    expect(session.currentPhase).toBe('ready');
    await expect(session.ensure()).resolves.toBeNull();
  });

  it('取票失败按退避重试，成功后退避归零', async () => {
    const { session, engine, clock, provider } = rig();
    provider.next = () => Promise.reject(new Error('后台 500'));
    session.start();
    await flush();
    expect(session.currentPhase).toBe('waiting');
    expect(clock.pending()).toEqual([RETRY_BACKOFF_MS[0]]);
    await clock.advance(RETRY_BACKOFF_MS[0] ?? 0);
    expect(provider.calls).toBe(2);
    expect(clock.pending()).toEqual([RETRY_BACKOFF_MS[1]]);
    provider.next = () => Promise.resolve({ token: 'ok' });
    await clock.advance(RETRY_BACKOFF_MS[1] ?? 0);
    expect(engine.logins()).toEqual(['login:ok']);
    expect(session.currentPhase).toBe('ready');
    expect(clock.pending()).toEqual([]);
  });

  it('退避封顶 60 s', async () => {
    const { session, clock, provider } = rig();
    provider.next = () => Promise.reject(new Error('x'));
    session.start();
    await flush();
    for (const step of RETRY_BACKOFF_MS) await clock.advance(step);
    expect(clock.pending()).toEqual([60000]);
  });

  it('拨号时在退避里：立刻再试一次并等它的结果', async () => {
    const { session, provider, engine } = rig();
    provider.next = () => Promise.reject(new Error('x'));
    session.start();
    await flush();
    provider.next = () => Promise.resolve({ token: 'now' });
    await expect(session.ensure()).resolves.toBeNull();
    expect(engine.logins()).toEqual(['login:now']);
  });

  it('并发 ensure 共用一轮尝试', async () => {
    const { session, provider, engine } = rig();
    engine.holdLogin = true;
    session.start();
    await flush();
    const a = session.ensure();
    const b = session.ensure();
    engine.hold?.resolve();
    await expect(Promise.all([a, b])).resolves.toEqual([null, null]);
    expect(provider.calls).toBe(1);
  });

  it('失败类别：2003 是网络；取票失败看设备有没有网', async () => {
    const r1 = rig();
    r1.engine.loginError = new RtcError(ErrorCode.networkUnreachable);
    r1.session.start();
    await flush();
    await expect(r1.session.ensure()).resolves.toBe('network');

    const r2 = rig();
    r2.provider.next = () => Promise.reject(new Error('x'));
    r2.session.start();
    await flush();
    await expect(r2.session.ensure()).resolves.toBe('service');
    r2.online.value = false;
    await expect(r2.session.ensure()).resolves.toBe('network');
  });

  it('登录失败后先登出：Kit 是唯一的重试者', async () => {
    const { session, engine } = rig();
    engine.loginError = new RtcError(ErrorCode.tokenInvalid);
    session.start();
    await flush();
    expect(engine.log).toEqual(['logout', 'login:t1', 'logout']);
  });

  it('停止后迟到的票作废，不去登录', async () => {
    const { session, engine, provider } = rig();
    let release: (t: KitToken) => void = () => undefined;
    provider.next = () => new Promise((resolve) => { release = resolve; });
    session.start();
    await flush();
    const waiting = session.ensure();
    session.stop();
    await expect(waiting).resolves.toBe('service');
    release({ token: 'late' });
    await flush();
    expect(engine.logins()).toEqual([]);
    expect(session.currentPhase).toBe('idle');
  });

  it('网络恢复时在退避里的立刻再试', async () => {
    const { session, provider } = rig();
    provider.next = () => Promise.reject(new Error('x'));
    session.start();
    await flush();
    session.onNetworkRestored();
    await flush();
    expect(provider.calls).toBe(2);
  });

  it('票快过期：取新票交给 engine', async () => {
    const { session, engine, provider } = rig();
    session.start();
    await flush();
    provider.next = () => Promise.resolve({ token: 'fresh', expiresAtMs: 99 });
    session.onTokenWillExpire();
    await flush();
    expect(engine.log).toContain('update:fresh:99');
  });

  it('authExpired 被踢：登出后重新取票登录', async () => {
    const { session, engine } = rig();
    session.start();
    await flush();
    session.onKickedOut('authExpired');
    await flush();
    expect(engine.logins()).toEqual(['login:t1', 'login:t2']);
    expect(session.currentPhase).toBe('ready');
  });

  it('顶号 / 配置被拒：不自动重试，但用户亲手点时仍试一次', async () => {
    const { session, clock, provider } = rig();
    session.start();
    await flush();
    session.onKickedOut('takenOver');
    expect(session.currentPhase).toBe('halted');
    expect(clock.pending()).toEqual([]);
    provider.next = () => Promise.reject(new Error('x'));
    await expect(session.ensure()).resolves.toBe('service');
    expect(session.currentPhase).toBe('halted');
    expect(clock.pending()).toEqual([]);
  });

  it('已登录、正在重连：催 engine 立刻连并等 connected', async () => {
    const { session, engine } = rig();
    session.start();
    await flush();
    session.onDisconnected();
    const waiting = session.ensure();
    expect(engine.log).toContain('nudge');
    session.onConnected();
    await expect(waiting).resolves.toBeNull();
  });

  it('等太久按网络失败算', async () => {
    const { session, clock } = rig();
    session.start();
    await flush();
    session.onDisconnected();
    const waiting = session.ensure();
    await clock.advance(ENSURE_TIMEOUT_MS);
    await expect(waiting).resolves.toBe('network');
  });

  it('没启动时 ensure 直接失败', async () => {
    const { session } = rig();
    await expect(session.ensure()).resolves.toBe('service');
  });
});
