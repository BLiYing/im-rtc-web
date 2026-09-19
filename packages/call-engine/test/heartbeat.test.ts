import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Heartbeat, MISS_LIMIT } from '../src/signaling/heartbeat.js';

/** 心跳判死的时机（协议 §1.3）：连续 3 个周期，不是 4 个。 */
describe('Heartbeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('第 MISS_LIMIT 个周期就判死，只发 MISS_LIMIT-1 个 ping', () => {
    const sendPing = vi.fn();
    const onDead = vi.fn();
    const hb = new Heartbeat({ sendPing, onDead });
    hb.start(15);

    vi.advanceTimersByTime(15_000 * (MISS_LIMIT - 1));
    expect(onDead).not.toHaveBeenCalled();
    expect(sendPing).toHaveBeenCalledTimes(MISS_LIMIT - 1);

    vi.advanceTimersByTime(15_000);
    expect(onDead).toHaveBeenCalledTimes(1);
    expect(sendPing).toHaveBeenCalledTimes(MISS_LIMIT - 1);
    hb.stop();
  });

  it('收到任何帧计数归零', () => {
    const onDead = vi.fn();
    const hb = new Heartbeat({ sendPing: vi.fn(), onDead });
    hb.start(15);
    vi.advanceTimersByTime(15_000 * (MISS_LIMIT - 1));
    hb.noteFrameReceived();
    vi.advanceTimersByTime(15_000 * (MISS_LIMIT - 1));
    expect(onDead).not.toHaveBeenCalled();
    hb.stop();
  });
});
