import { useLayoutEffect, useRef, useState } from 'react';

/**
 * useElementSize 观察一个元素的尺寸。
 *
 * 九宫格要按**容器形状**决定行列、按容器大小算正方形格子的边长，
 * 而这两件事在 CSS 里表达不出来（`aspect-ratio` 只能定形状，定不了列数）。
 * 所以量一下。
 *
 * `ResizeObserver` 在 jsdom 里不存在——**没有它也要能渲染**，
 * 那时尺寸停在 0，组件按「还不知道多大」的分支走（见 ActiveCall）。
 */
export function useElementSize<T extends HTMLElement>(): {
  // React 18 的 `RefObject<T>` 才是 `<div ref>` 能接的类型；
  // `useRef<T>(null)` 推出来的是 `RefObject<T | null>`，直接传会被类型系统挡下。
  readonly ref: React.RefObject<T>;
  readonly width: number;
  readonly height: number;
} {
  const ref = useRef<T>(null) as React.RefObject<T>;
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
