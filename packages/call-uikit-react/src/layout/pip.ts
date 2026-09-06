import { callMetrics } from '../theme.js';

/**
 * 小窗（PiP）的位置算术：四角吸附、控制条避让、按容器形状选尺寸。
 *
 * 纯函数，不碰 DOM。拖动手势那一层在 `usePipDrag.ts`，它只负责把指针坐标喂进来。
 * 这里的每一条规则都来自交互稿 §04「边界规则」，与 iOS 的同名算法必须算出一样的角。
 */

/** PipCorner 是小窗能停的四个角。 */
export type PipCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** PipSize 是小窗的宽高。 */
export interface PipSize {
  readonly width: number;
  readonly height: number;
}

/** PipPoint 是容器坐标系里的一个点（左上角为原点）。 */
export interface PipPoint {
  readonly x: number;
  readonly y: number;
}

/** 默认停右上角：本端画面惯例在这里（FaceTime / 微信同做法）。 */
export const defaultPipCorner: PipCorner = 'top-right';

/**
 * pipSizeFor 按**容器形状**选尺寸：竖屏容器 3:4（96×128），横屏 16:9（160×90）。
 *
 * 判据是容器不是设备：桌面浏览器缩成窄窗口也该按竖屏那套走。
 */
export function pipSizeFor(containerWidth: number, containerHeight: number): PipSize {
  if (containerHeight <= 0) return callMetrics.pipLandscape;
  return containerWidth / containerHeight < 1 ? callMetrics.pipPortrait : callMetrics.pipLandscape;
}

/**
 * nearestCorner 找离某个点最近的角。松手时调它：**吸附到最近的角，不是最近的边**。
 */
export function nearestCorner(point: PipPoint, containerWidth: number, containerHeight: number): PipCorner {
  const right = point.x > containerWidth / 2;
  const bottom = point.y > containerHeight / 2;
  if (right) return bottom ? 'bottom-right' : 'top-right';
  return bottom ? 'bottom-left' : 'top-left';
}

/**
 * cornerOrigin 算某个角的小窗左上角坐标。
 *
 * `liftBottom` 是控制条的避让：控制条显示时，停在下面两个角的小窗要上移 88，
 * 否则会被控制条压住（交互稿 §04）。
 */
export function cornerOrigin(
  corner: PipCorner,
  size: PipSize,
  containerWidth: number,
  containerHeight: number,
  liftBottom = 0,
): PipPoint {
  const inset = callMetrics.pipInset;
  const x = corner.endsWith('right') ? containerWidth - size.width - inset : inset;
  const y = corner.startsWith('bottom')
    ? containerHeight - size.height - inset - liftBottom
    : inset;
  return { x: Math.max(x, 0), y: Math.max(y, 0) };
}

/** clampOrigin 把拖动中的左上角夹在容器里，不让小窗被拖出边界。 */
export function clampOrigin(origin: PipPoint, size: PipSize, containerWidth: number, containerHeight: number): PipPoint {
  const maxX = Math.max(containerWidth - size.width, 0);
  const maxY = Math.max(containerHeight - size.height, 0);
  return {
    x: Math.min(Math.max(origin.x, 0), maxX),
    y: Math.min(Math.max(origin.y, 0), maxY),
  };
}

/** allCorners 是四个角的列表，画「可停位置」的虚线框时用。 */
export const allCorners: readonly PipCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** isPipCorner 是 PipCorner 的运行时校验——从 sessionStorage 读回来的值不能直接信。 */
export function isPipCorner(value: unknown): value is PipCorner {
  return typeof value === 'string' && (allCorners as readonly string[]).includes(value);
}
