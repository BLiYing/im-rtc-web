/**
 * 重连退避：**三端同一份档位**（RTC_PROTOCOL.md §1.4）。
 *
 * 档位写死成表而不是算指数，是为了四端一眼能对上；抖动是为了避免
 * 「服务端重启后所有客户端在同一毫秒回来」把它再打挂一次。
 */

/** BACKOFF_STEPS_MS 是退避档位，之后固定用最后一档。 */
export const BACKOFF_STEPS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/** JITTER_RATIO 是抖动幅度：每档 ±20%。 */
export const JITTER_RATIO = 0.2;

/**
 * backoffDelayMs 返回第 attempt 次重连该等多久（attempt 从 0 开始）。
 *
 * `random` 可注入以便测试；默认 Math.random。
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const index = Math.min(Math.max(attempt, 0), BACKOFF_STEPS_MS.length - 1);
  // 上面的 clamp 保证 index 落在数组范围内，这个断言与它一一对应。
  const base = BACKOFF_STEPS_MS[index] as number;
  const jitter = base * JITTER_RATIO * (random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}
