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

/** 间距占容器短边的比例，只影响边界情况。四端同一个数。 */
const GAP_RATIO = 0.02;

/**
 * gridDimensions 按人数与**容器的宽高比**算行列。
 *
 * # 为什么要看宽高比
 *
 * 原先固定取 `ceil(sqrt(n))` 列。竖屏（手机、窄浏览器窗口）上 2 个人就成了
 * **1 行 2 列**：每格半个宽、整个高，画面被拉成两条细长条。
 * 同样一份人数，横屏上 2 列才是对的。**决定列数的不是人数，是容器形状。**
 *
 * # 规则：让格子尽量大，且恒为正方形
 *
 * 逐个试列数，算出那种排法下正方形格子的边长
 * `min(按列分到的宽, 按行分到的高)`，取边长最大的那个；平手时取行数少的。
 *
 * 这条规则四端共用一份（iOS 的 `imGridDimensions` 是同一个算法），
 * 同样的人数 + 同样的容器形状，各端算出来必须一样。
 *
 * @param aspect 容器的 宽 / 高。默认 1（正方形容器），此时退化成老的 `ceil(sqrt(n))`。
 */
export function gridDimensions(count: number, aspect = 1): GridDimensions {
  const n = Math.min(Math.max(count, 1), MAX_TILES);
  // 归一化成「宽 = aspect、高 = 1」的容器；只比大小，绝对尺寸无所谓。
  const width = Math.max(aspect, 0.01);
  const gap = Math.min(width, 1) * GAP_RATIO;

  let best: GridDimensions = { cols: n, rows: 1 };
  let bestSide = -1;
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const side = Math.min((width - (cols - 1) * gap) / cols, (1 - (rows - 1) * gap) / rows);
    if (side > bestSide || (side === bestSide && rows < best.rows)) {
      best = { cols, rows };
      bestSide = side;
    }
  }
  return best;
}

/**
 * cellSide 算正方形格子的边长（像素）。
 *
 * **格子必须是正方形**：让它吃满整块区域（`1fr` × `1fr`）的话，
 * 竖屏两个人就是两条又高又窄的长条，画面被拉伸得很难看。
 */
export function cellSide(
  dims: GridDimensions,
  width: number,
  height: number,
  gap: number,
): number {
  const byWidth = (width - (dims.cols - 1) * gap) / dims.cols;
  const byHeight = (height - (dims.rows - 1) * gap) / dims.rows;
  return Math.max(Math.min(byWidth, byHeight), 0);
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
