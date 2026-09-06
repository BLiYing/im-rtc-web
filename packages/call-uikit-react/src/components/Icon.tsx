import type { ReactNode } from 'react';

import { callColors, callMetrics } from '../theme.js';
import type { IconName } from './iconShapes.js';
import { iconShape } from './iconShapes.js';

export type { IconName } from './iconShapes.js';

/**
 * 通话控制按钮的图标。**内联 SVG，不引图标库、不用 emoji。**
 *
 * # 为什么不用 emoji
 *
 * iOS 端踩过一次：拿 emoji 当图标（🎤 📷 🔊），真机上**渲染成一个个方框问号**——
 * emoji 的字形要靠字体回退，并不保证命中。Web 端虽然多半能显示，
 * 但同一套界面在两端长得不一样本身就是问题（四端行为一致是本产品的约束）。
 *
 * # 为什么不引图标库
 *
 * 十来个图标而已，一个依赖换十几个图标不划算；而且 uikit 是要发到 npm 的包，
 * 多一个运行时依赖就多一份宿主的构建负担。内联 SVG 还能跟着 `currentColor` 走，
 * 开/关两态换颜色不用换图。路径数据在 `iconShapes.tsx`，与设计稿 §05 逐条一致。
 */
export interface IconProps {
  readonly name: IconName;
  /** 渲染尺寸，默认 26（规范 §04）。大按钮里传 30，角标里传 14。 */
  readonly size?: number;
}

/** Icon 画一个图标，颜色跟 `currentColor`。 */
export function Icon({ name, size = callMetrics.icon }: IconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {iconShape(name)}
    </svg>
  );
}

/**
 * NetworkBars 是三根柱子的网络质量图标（规范 §05 `net-bars`）。
 *
 * 输入是 `networkQuality` 的 level（0~6，协议 §3.5 的表）：1~2 三根亮、3~4 两根、
 * 5~6 一根；**0 = 未知时什么都不画**——画三根全灰会让人以为网断了。
 * 与 iOS 的 `IMNetworkBars` 同一套分档。
 */
export function NetworkBars({ level, size = 14 }: { readonly level: number; readonly size?: number }): ReactNode {
  if (level <= 0) return null;
  const lit = barsLit(level);
  const color = level >= 5 ? callColors.warning : 'currentColor';
  const bars = [
    { x: 3, y: 14, h: 6 },
    { x: 10.2, y: 9, h: 11 },
    { x: 17.4, y: 4, h: 16 },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {bars.map((bar, i) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width={3.6}
          height={bar.h}
          rx={1}
          fill={color}
          opacity={i < lit ? 1 : 0.35}
        />
      ))}
    </svg>
  );
}

/** barsLit 把 level 翻成亮几根。 */
export function barsLit(level: number): number {
  if (level <= 0) return 0;
  if (level <= 2) return 3;
  if (level <= 4) return 2;
  return 1;
}

/** networkText 是网络质量的人话（规范 §08）。 */
export function networkText(level: number): string {
  if (level <= 0) return '';
  if (level <= 2) return '网络良好';
  if (level <= 4) return '网络一般';
  if (level === 5) return '网络很差';
  return '正在重连…';
}

/** isNetworkPoor 判断要不要出「对方网络不佳」的提示（3 以上）。 */
export function isNetworkPoor(level: number): boolean {
  return level >= 3;
}
