import { describe, expect, it } from 'vitest';

import { elapsedSec, formatDuration } from '../src/format/duration.js';

describe('通话时长', () => {
  it('一小时以内两段、超过一小时三段', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(9)).toBe('00:09');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('负数与 NaN 退化成 00:00 而不是 NaN:NaN', () => {
    // beganAtMs 为 0 时算出来就是个巨大的负数，这条不是假设是必然。
    expect(formatDuration(-5)).toBe('00:00');
    expect(formatDuration(Number.NaN)).toBe('00:00');
  });

  it('还没接通时秒数恒为 0', () => {
    expect(elapsedSec(0, Date.now())).toBe(0);
    expect(elapsedSec(1000, 4200)).toBe(3);
    expect(elapsedSec(5000, 1000)).toBe(0); // 时钟回拨也不该出负数
  });
});
