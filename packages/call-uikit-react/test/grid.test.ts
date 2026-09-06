import { describe, expect, it } from 'vitest';

import { MAX_REMOTE_TILES, MAX_TILES, cellSide, gridDimensions, tileLayer, visibleTiles } from '../src/layout/grid.js';

describe('九宫格布局', () => {
  it('按人数排出尽量接近正方形的格子', () => {
    const cases: [number, number, number][] = [
      [1, 1, 1],
      [2, 2, 1],
      [3, 2, 2], // 2×2 留一个空位，比 3×1 的细长条好看
      [4, 2, 2],
      [5, 3, 2],
      [6, 3, 2],
      [9, 3, 3],
    ];
    for (const [count, cols, rows] of cases) {
      expect(gridDimensions(count), `${count} 人`).toEqual({ cols, rows });
    }
  });

  it('人数超上限或为 0 时不会算出荒唐的格子', () => {
    expect(gridDimensions(0)).toEqual({ cols: 1, rows: 1 });
    expect(gridDimensions(99)).toEqual({ cols: 3, rows: 3 });
    expect(gridDimensions(-3)).toEqual({ cols: 1, rows: 1 });
  });

  it('格子越小报的层越低——这是省带宽的地方', () => {
    expect(tileLayer(1)).toBe('h');
    expect(tileLayer(2)).toBe('m');
    expect(tileLayer(4)).toBe('m');
    expect(tileLayer(5)).toBe('l');
    expect(tileLayer(9)).toBe('l');
  });

  /** 远端截到 8：**本端恒占一格**，9 个远端加上自己就是 10 格，而只有 9 个坑。 */
  it('超过一屏的格子被截掉，不缩到看不清', () => {
    const many = Array.from({ length: 12 }, (_, i) => i);
    expect(visibleTiles(many)).toHaveLength(MAX_REMOTE_TILES);
    expect(visibleTiles(many).length + 1).toBe(MAX_TILES);
    expect(visibleTiles([1, 2])).toHaveLength(2);
  });
});

/*
  **决定列数的不是人数，是容器形状。**

  竖屏（手机、窄浏览器窗口）上 2 个人必须上下摞——原先固定 `ceil(sqrt(n))`
  会排成 1 行 2 列，每格半个宽、整个高，画面被拉成两条细长条。
  iOS 真机上反馈是「很丑」，Web 端窄窗口同理。
*/
describe('行列跟着容器形状走', () => {
  it('两个人：竖屏上下摞，横屏左右排', () => {
    expect(gridDimensions(2, 0.7)).toEqual({ cols: 1, rows: 2 });
    expect(gridDimensions(2, 1.8)).toEqual({ cols: 2, rows: 1 });
  });

  it('人多了两种形状都收敛到方阵', () => {
    expect(gridDimensions(4, 0.7)).toEqual({ cols: 2, rows: 2 });
    expect(gridDimensions(4, 1.8)).toEqual({ cols: 2, rows: 2 });
    expect(gridDimensions(9, 0.7)).toEqual({ cols: 3, rows: 3 });
  });

  /**
   * 除了「竖屏 3~4 格恒为两列」那条明写的规则，挑出来的排法必须**真的是格子最大的那一种**
   * ——这是这条规则剩下的全部意义。
   */
  it('挑的是正方形格子最大的排法', () => {
    for (let count = 1; count <= MAX_TILES; count += 1) {
      for (const aspect of [0.4, 0.5, 0.648, 0.7, 1, 1.4, 2]) {
        // 竖屏 3~4 格是产品规则，不参与「格子最大」的比较（见 gridDimensions 的注释）。
        if (aspect < 1 && (count === 3 || count === 4)) continue;
        const chosen = gridDimensions(count, aspect);
        const best = cellSide(chosen, aspect, 1, Math.min(aspect, 1) * 0.02);
        for (let cols = 1; cols <= count; cols += 1) {
          const dims = { cols, rows: Math.ceil(count / cols) };
          const side = cellSide(dims, aspect, 1, Math.min(aspect, 1) * 0.02);
          expect(side, `${count} 人 / aspect ${aspect} / ${cols}×${dims.rows}`)
            .toBeLessThanOrEqual(best + 1e-9);
        }
      }
    }
  });

  /**
   * 竖屏上 3~4 格恒为两列——**不管容器多窄**。
   *
   * 按「格子最大」挑的话，翻转压在手机的常见比例上：iPhone 15 Pro 的舞台区算出来
   * aspect ≈ 0.682（2×2）、16 Pro Max ≈ 0.648（一竖条），同一通电话两种样子。
   * 0.48 是 Android 修 stage 下边界之前那个比例（多算了一整条控制条），一并钉住。
   */
  it('竖屏三格与四格恒为两列', () => {
    for (const aspect of [0.4, 0.48, 0.6, 0.648, 0.682, 0.7, 0.9]) {
      expect(gridDimensions(3, aspect), `aspect ${aspect}`).toEqual({ cols: 2, rows: 2 });
      expect(gridDimensions(4, aspect), `aspect ${aspect}`).toEqual({ cols: 2, rows: 2 });
    }
    // 两个人仍然上下摞（那一条是尺寸判据，没被这条规则盖掉）。
    expect(gridDimensions(2, 0.7)).toEqual({ cols: 1, rows: 2 });
    // 横屏不受这条约束：宽容器上三个人一行排开。
    expect(gridDimensions(3, 2)).toEqual({ cols: 3, rows: 1 });
  });

  /** 格子是正方形：边长取「按列分到的宽」与「按行分到的高」里小的那个。 */
  it('边长两边都放得下', () => {
    expect(cellSide({ cols: 2, rows: 2 }, 408, 600, 8)).toBe(200);
    expect(cellSide({ cols: 2, rows: 2 }, 600, 408, 8)).toBe(200);
    expect(cellSide({ cols: 3, rows: 3 }, 0, 0, 8)).toBe(0);
  });
});
