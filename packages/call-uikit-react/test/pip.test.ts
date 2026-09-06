import { describe, expect, it } from 'vitest';

import {
  clampOrigin, cornerOrigin, isPipCorner, nearestCorner, pipSizeFor,
} from '../src/layout/pip.js';

/**
 * 小窗位置的算术（交互稿 §04）。与 iOS 的同名算法必须算出一样的角——
 * 这里的数就是那边的向量。
 */
describe('小窗尺寸按容器形状选', () => {
  it('竖屏容器 3:4，横屏容器 16:9', () => {
    expect(pipSizeFor(390, 844)).toEqual({ width: 96, height: 128 });
    expect(pipSizeFor(1280, 720)).toEqual({ width: 160, height: 90 });
    // 量不到高度（首帧）按横屏走，不至于渲染不出来。
    expect(pipSizeFor(0, 0)).toEqual({ width: 160, height: 90 });
  });
});

describe('四角吸附', () => {
  it('松手吸到离小窗中心最近的角', () => {
    expect(nearestCorner({ x: 10, y: 10 }, 400, 800)).toBe('top-left');
    expect(nearestCorner({ x: 390, y: 10 }, 400, 800)).toBe('top-right');
    expect(nearestCorner({ x: 10, y: 790 }, 400, 800)).toBe('bottom-left');
    expect(nearestCorner({ x: 390, y: 790 }, 400, 800)).toBe('bottom-right');
  });

  it('角的坐标离边 12；下面两个角在控制条显示时上移', () => {
    const size = { width: 96, height: 128 };
    expect(cornerOrigin('top-left', size, 400, 800)).toEqual({ x: 12, y: 12 });
    expect(cornerOrigin('top-right', size, 400, 800)).toEqual({ x: 400 - 96 - 12, y: 12 });
    expect(cornerOrigin('bottom-right', size, 400, 800)).toEqual({ x: 292, y: 800 - 128 - 12 });
    // 控制条出现 → 上移 88（规范 §04 pipLift）。
    expect(cornerOrigin('bottom-right', size, 400, 800, 88)).toEqual({ x: 292, y: 800 - 128 - 12 - 88 });
    // 容器比小窗还小时不出负数。
    expect(cornerOrigin('bottom-right', size, 50, 50)).toEqual({ x: 0, y: 0 });
  });

  it('拖动中的位置夹在容器里', () => {
    const size = { width: 96, height: 128 };
    expect(clampOrigin({ x: -30, y: -30 }, size, 400, 800)).toEqual({ x: 0, y: 0 });
    expect(clampOrigin({ x: 999, y: 999 }, size, 400, 800)).toEqual({ x: 304, y: 672 });
    expect(clampOrigin({ x: 100, y: 200 }, size, 400, 800)).toEqual({ x: 100, y: 200 });
  });

  it('从 sessionStorage 读回来的值要校验', () => {
    expect(isPipCorner('top-left')).toBe(true);
    expect(isPipCorner('middle')).toBe(false);
    expect(isPipCorner(null)).toBe(false);
  });
});
