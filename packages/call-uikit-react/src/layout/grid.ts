import type { Layer } from '@im-rtc/call-engine';

/**
 * 九宫格布局与**层上界**的计算。
 *
 * 这一段是纯算术，但它直接决定了带宽：格子越小、报的层越低、服务端发的码率越低。
 * 所以它值得单测，而不是散在组件的 className 里（CONVENTIONS §2）。
 *
 * 群通话上限 9 人（拍板 §11-1），正好 3×3。
 */

/** MAX_TILES 是一屏最多摆几个格子。超过的部分不显示（v1 不做翻页）。 */
export const MAX_TILES = 9;

/** GridDimensions 是格子的行列数。 */
export interface GridDimensions {
  readonly cols: number;
  readonly rows: number;
}

/**
 * gridDimensions 按人数算行列。
 *
 * 取「尽量接近正方形」而不是固定 3 列：4 个人排成 2×2 每格都比 3×2 大得多，
 * 而 3 个人排 2×2（留一个空位）比 3×1 那种细长条好看。
 */
export function gridDimensions(count: number): GridDimensions {
  const n = Math.min(Math.max(count, 1), MAX_TILES);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

/**
 * tileLayer 决定每个格子该报哪一层（协议 §3.5）。
 *
 * **报的是上界不是命令**：服务端会取 min(这个上界, 带宽估计允许的层, 实际存在的层)。
 * 分档按格子的实际像素宽走——1 个人是全屏、2~4 人半屏、5 人以上就是缩略图了。
 *
 * 被放大的那个格子单独报 h（见 `focusedLayer`），不受这里的档位限制。
 */
export function tileLayer(count: number): Layer {
  if (count <= 1) return 'h';
  if (count <= 4) return 'm';
  return 'l';
}

/** focusedLayer 是被放大（双击/主讲人大画面）的那个格子该报的层。 */
export const focusedLayer: Layer = 'h';

/**
 * visibleTiles 截掉超出一屏的格子。
 *
 * 截断而不是缩到看不清：9 个 3×3 已经是「能看清是谁」的下限，
 * 再多就该做翻页或「只看主讲人」，那是后续期的事。
 */
export function visibleTiles<T>(tiles: readonly T[]): readonly T[] {
  return tiles.length <= MAX_TILES ? tiles : tiles.slice(0, MAX_TILES);
}
