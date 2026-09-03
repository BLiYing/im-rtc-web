/**
 * 通话时长的格式化。
 *
 * 抽出来单测是因为它有两个容易写错的边界：**跨小时**要变成三段，
 * **负数/NaN** 要退化成 00:00 而不是显示 `NaN:NaN`
 * （`beganAtMs` 为 0 时算出来就是个巨大的负数）。
 */

/** formatDuration 把秒数格式化成 `mm:ss` 或 `h:mm:ss`。 */
export function formatDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return '00:00';
  const sec = Math.floor(totalSec);
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** elapsedSec 算从某个时刻到现在的秒数。beganAtMs 为 0（还没接通）时返回 0。 */
export function elapsedSec(beganAtMs: number, nowMs: number): number {
  if (beganAtMs <= 0) return 0;
  return Math.max(0, Math.floor((nowMs - beganAtMs) / 1000));
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
