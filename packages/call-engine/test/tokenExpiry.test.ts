import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_LEAD_MS, TokenExpiryTimer } from '../src/signaling/tokenExpiry.js';

/** harness 造一个时钟与定时器都可控的 timer。 */
function harness(nowMs = 1_757_000_000_000, leadMs?: number) {
  const fired: { expiresAtMs: number }[] = [];
  let now = nowMs;
  const scheduled: { fn: () => void; ms: number }[] = [];
  const timer = new TokenExpiryTimer({
    ...(leadMs === undefined ? {} : { leadMs }),
    onWillExpire: (info) => fired.push(info),
    now: () => now,
    setTimer: (fn, ms) => {
      scheduled.push({ fn, ms });
      return scheduled.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      scheduled.pop();
    },
  });
  return {
    timer,
    fired,
    scheduled,
    advanceTo: (t: number) => {
      now = t;
    },
    runLast: () => scheduled.at(-1)?.fn(),
  };
}

describe('接入票到期提醒', () => {
  it('按「到期时刻 - 提前量」排定，默认提前 60s', () => {
    const h = harness();
    const expiresAt = 1_757_000_000_000 + 3_600_000; // 一小时后
    h.timer.arm(expiresAt);

    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]?.ms).toBe(3_600_000 - DEFAULT_LEAD_MS);
    expect(h.timer.isArmed).toBe(true);
  });

  it('触发时带上到期时刻，且同一张票只触发一次', () => {
    const h = harness();
    const expiresAt = 1_757_000_000_000 + 3_600_000;
    h.timer.arm(expiresAt);
    h.runLast();

    expect(h.fired).toEqual([{ expiresAtMs: expiresAt }]);
    // 触发之后自己卸掉，不会再有第二次。
    expect(h.timer.isArmed).toBe(false);
  });

  /*
    服务端说「未知」时**不能报错、也不能瞎猜一个时刻**——那样会在票其实还早的时候
    催宿主换票，或者更糟：按一个错误的时刻算出负延迟、立刻空转。
    正确行为是解除武装，退化成打这个补丁之前的被动行为。
  */
  it('到期时刻为 0（服务端说未知）时不排定，也不报错', () => {
    const h = harness();
    h.timer.arm(0);
    expect(h.scheduled).toHaveLength(0);
    expect(h.timer.isArmed).toBe(false);
    expect(h.fired).toHaveLength(0);
  });

  it('负数同样当未知处理', () => {
    const h = harness();
    h.timer.arm(-1);
    expect(h.timer.isArmed).toBe(false);
  });

  /*
    票只剩 10 秒时**更**需要提醒宿主，不是更不需要。静默跳过的话，
    这种「登录时票就快过期了」的场景会完全失去提前量。
  */
  it('已经进入提前量窗口时立刻触发（延迟钳到 0，不排到过去）', () => {
    const now = 1_757_000_000_000;
    const h = harness(now);
    h.timer.arm(now + 10_000); // 只剩 10s，远小于 60s 提前量

    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]?.ms).toBe(0);
    h.runLast();
    expect(h.fired).toHaveLength(1);
  });

  it('票已经过期也立刻触发一次', () => {
    const now = 1_757_000_000_000;
    const h = harness(now);
    h.timer.arm(now - 60_000);
    expect(h.scheduled[0]?.ms).toBe(0);
  });

  it('重新 arm 会取消上一个定时器，不会两张票各响一次', () => {
    const now = 1_757_000_000_000;
    const h = harness(now);
    h.timer.arm(now + 3_600_000);
    h.timer.arm(now + 7_200_000);

    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]?.ms).toBe(7_200_000 - DEFAULT_LEAD_MS);
  });

  it('disarm 之后不再触发，且可重复调用', () => {
    const h = harness();
    h.timer.arm(1_757_000_000_000 + 3_600_000);
    h.timer.disarm();
    h.timer.disarm();
    expect(h.timer.isArmed).toBe(false);
  });

  it('提前量可配', () => {
    const now = 1_757_000_000_000;
    const h = harness(now, 5_000);
    h.timer.arm(now + 60_000);
    expect(h.scheduled[0]?.ms).toBe(55_000);
  });

  /*
    arm 是在握手成功的路径上调的。同步回调会让宿主在 onTokenWillExpire 里调的
    updateToken 重入到还没走完的连接流程里，所以哪怕延迟是 0 也必须经过定时器。
  */
  it('即使延迟为 0 也走定时器，不同步回调', () => {
    const now = 1_757_000_000_000;
    const fired: unknown[] = [];
    const timer = new TokenExpiryTimer({
      onWillExpire: (info) => fired.push(info),
      now: () => now,
      setTimer: (_fn, ms) => {
        expect(ms).toBe(0);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => undefined,
    });
    timer.arm(now); // 正好到期
    expect(fired).toHaveLength(0); // 没有同步烧掉
  });

  it('默认实现用真的 setTimeout（不注入时也能跑）', () => {
    vi.useFakeTimers();
    try {
      const fired: unknown[] = [];
      const timer = new TokenExpiryTimer({ leadMs: 1_000, onWillExpire: (i) => fired.push(i) });
      timer.arm(Date.now() + 3_000);
      vi.advanceTimersByTime(2_100);
      expect(fired).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
