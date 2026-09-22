import { dt } from './demoText.js';

/**
 * 通话记录的时间文案（四端统一的规则，用例表也四端一致）：
 *
 * | 发起于 | 显示 |
 * |---|---|
 * | 今天 | `HH:mm` |
 * | 昨天 | `昨天 HH:mm` |
 * | 今年更早 | `M月d日 HH:mm` |
 * | 往年 | `yyyy年M月d日 HH:mm` |
 *
 * - **按自然日**判断今天 / 昨天（时区内的零点），不按 24 小时：昨天 23:50 的通话今天 00:10 看仍是「昨天」。
 * - 用**发起时间**，跨零点的通话归到发起那天。
 * - 记录时间不早于 `nowMs`（设备与服务端时钟有偏差）按今天处理，不显示「明天」。
 * - 时分固定 24 小时制补零。`timeZone` 缺省用浏览器本地时区；测试里显式传，别依赖机器时区。
 */
interface Parts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function partsOf(ms: number, timeZone: string | undefined): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    ...(timeZone === undefined ? {} : { timeZone }),
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  });
  const get = (type: string): number =>
    Number(fmt.formatToParts(new Date(ms)).find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** 自然日序号：只用来比「相差几天」，与时区无关地把年月日换成连续整数。 */
function dayNumber(p: Parts): number {
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function formatCallTime(startedAtMs: number, nowMs: number, timeZone?: string): string {
  const started = partsOf(startedAtMs, timeZone);
  const now = partsOf(nowMs, timeZone);
  const time = `${pad(started.hour)}:${pad(started.minute)}`;
  const daysAgo = dayNumber(now) - dayNumber(started);

  if (startedAtMs >= nowMs || daysAgo <= 0) return time;
  if (daysAgo === 1) return dt('demo.time.yesterday', { time });
  if (started.year === now.year) return dt('demo.time.sameYear', { month: started.month, day: started.day, time });
  return dt('demo.time.otherYear', { year: started.year, month: started.month, day: started.day, time });
}
