import { describe, expect, it } from 'vitest';

import { formatCallTime } from '../src/historyTime';

/** 通话记录时间文案：四端共用同一张用例表（今天 / 昨天 / 今年更早 / 往年 / 跨零点 / 时钟偏差）。 */

const ZONE = 'Asia/Shanghai';

/** 按上海时间造毫秒时间戳（上海无夏令时，恒为 UTC+8）。 */
function at(y: number, mo: number, d: number, h: number, mi: number): number {
  return Date.UTC(y, mo - 1, d, h - 8, mi);
}

const fmt = (started: number, now: number): string => formatCallTime(started, now, ZONE);
const NOW = at(2026, 9, 19, 11, 40);

describe('formatCallTime', () => {
  it('今天只显示时分', () => expect(fmt(at(2026, 9, 19, 11, 35), NOW)).toBe('11:35'));
  it('今天 00 点整也是今天', () => expect(fmt(at(2026, 9, 19, 0, 0), NOW)).toBe('00:00'));
  it('昨天', () => expect(fmt(at(2026, 9, 18, 23, 11), NOW)).toBe('昨天 23:11'));
  it('跨零点按自然日不按 24 小时', () =>
    expect(fmt(at(2026, 9, 18, 23, 50), at(2026, 9, 19, 0, 10))).toBe('昨天 23:50'));
  it('今年更早显示月日', () => expect(fmt(at(2026, 9, 15, 18, 17), NOW)).toBe('9月15日 18:17'));
  it('往年带年份', () => expect(fmt(at(2025, 12, 31, 9, 5), NOW)).toBe('2025年12月31日 09:05'));
  it('元旦看去年除夕算昨天', () =>
    expect(fmt(at(2025, 12, 31, 23, 59), at(2026, 1, 1, 8, 0))).toBe('昨天 23:59'));
  it('记录时间比现在还晚按今天', () => expect(fmt(at(2026, 9, 19, 11, 50), NOW)).toBe('11:50'));
});
