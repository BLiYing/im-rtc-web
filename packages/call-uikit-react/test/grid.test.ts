import { describe, expect, it } from 'vitest';

import { MAX_TILES, gridDimensions, tileLayer, visibleTiles } from '../src/layout/grid.js';

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

  it('超过一屏的格子被截掉，不缩到看不清', () => {
    const many = Array.from({ length: 12 }, (_, i) => i);
    expect(visibleTiles(many)).toHaveLength(MAX_TILES);
    expect(visibleTiles([1, 2])).toHaveLength(2);
  });
});
