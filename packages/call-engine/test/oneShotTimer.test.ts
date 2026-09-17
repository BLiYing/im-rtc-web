import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OneShotTimer } from '../src/signaling/oneShotTimer.js';

describe('OneShotTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('到点触发一次，触发前后 armed 分别为真、假', () => {
    const timer = new OneShotTimer();
    const fire = vi.fn();
    timer.start(1000, fire);
    expect(timer.armed).toBe(true);
    vi.advanceTimersByTime(999);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(timer.armed).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('重排会撤掉上一只', () => {
    const timer = new OneShotTimer();
    const first = vi.fn();
    const second = vi.fn();
    timer.start(1000, first);
    vi.advanceTimersByTime(500);
    timer.start(1000, second);
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancel 之后不触发，重复 cancel 无害', () => {
    const timer = new OneShotTimer();
    const fire = vi.fn();
    timer.start(1000, fire);
    timer.cancel();
    timer.cancel();
    expect(timer.armed).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(fire).not.toHaveBeenCalled();
  });

  it('回调里再 start 能排上（到点先置空再回调）', () => {
    const timer = new OneShotTimer();
    const again = vi.fn();
    timer.start(100, () => {
      expect(timer.armed).toBe(false);
      timer.start(100, again);
    });
    vi.advanceTimersByTime(100);
    expect(timer.armed).toBe(true);
    vi.advanceTimersByTime(100);
    expect(again).toHaveBeenCalledTimes(1);
  });
});
