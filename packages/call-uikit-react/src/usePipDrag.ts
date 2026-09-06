import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { PipCorner, PipPoint, PipSize } from './layout/pip.js';
import { clampOrigin, cornerOrigin, nearestCorner } from './layout/pip.js';
import { callMotion } from './theme.js';

/**
 * usePipDrag 是小窗的手势层（交互稿 §04）：单击、长按进入拖动、松手吸附最近的角。
 *
 * # 为什么手机上要先长按
 *
 * 小窗只有 96 宽，手指本身就有十来 px 的抖动。不加长按的话，用户想「点一下互换」
 * 十次里有三次会被判成拖动——小窗歪一点点然后弹回去，他不知道自己做错了什么。
 * 长按是给「移动」这个低频动作加的门槛，换来「互换」这个高频动作永远准。
 * **鼠标没有这个问题**（准），所以桌面上直接拖就能移动。
 *
 * 位置算术在 `layout/pip.ts`（纯函数，有单测）；这里只负责把指针事件喂进去。
 */
export interface PipDragOptions {
  readonly size: PipSize;
  /** 容器的宽高。四角坐标按它算。 */
  readonly bounds: { readonly width: number; readonly height: number };
  readonly corner: PipCorner;
  readonly onCorner: (corner: PipCorner) => void;
  /** 控制条显示时下面两个角要上移的量（0 = 不避让）。 */
  readonly lift?: number;
  /** 没拖动的单击。 */
  readonly onTap?: () => void;
}

/** PipDragResult 是给组件用的东西：当前位置、是否在拖、要挂的事件。 */
export interface PipDragResult {
  readonly origin: PipPoint;
  readonly isDragging: boolean;
  readonly handlers: {
    readonly onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  };
}

/** 鼠标移动超过这么多 px 才算拖，否则仍是单击。 */
const MOUSE_DRAG_THRESHOLD = 4;
/** 长按期间手指抖动超过这么多 px 就当作不是长按。 */
const TOUCH_JITTER = 8;

interface Gesture {
  startX: number;
  startY: number;
  startOrigin: PipPoint;
  pointerType: string;
  moved: boolean;
}

export function usePipDrag(options: PipDragOptions): PipDragResult {
  const { size, bounds, corner, onCorner, lift = 0, onTap } = options;
  const [dragging, setDragging] = useState(false);
  const [liveOrigin, setLiveOrigin] = useState<PipPoint | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restOrigin = cornerOrigin(corner, size, bounds.width, bounds.height, lift);

  const clearLongPress = useCallback((): void => {
    if (longPress.current !== null) clearTimeout(longPress.current);
    longPress.current = null;
  }, []);
  // 组件卸载时把还没触发的长按计时器清掉（CONVENTIONS §5：成对清理）。
  useEffect(() => clearLongPress, [clearLongPress]);

  const beginDrag = useCallback((): void => {
    if (gesture.current === null) return;
    setDragging(true);
    setLiveOrigin(gesture.current.startOrigin);
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>): void => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    gesture.current = {
      startX: e.clientX, startY: e.clientY, startOrigin: restOrigin, pointerType: e.pointerType, moved: false,
    };
    // 触摸要长按 350ms 才进拖动态；鼠标直接拖。
    if (e.pointerType === 'touch') {
      clearLongPress();
      longPress.current = setTimeout(beginDrag, callMotion.longPressMs);
    }
  }, [restOrigin, beginDrag, clearLongPress]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>): void => {
    const g = gesture.current;
    if (g === null) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    const distance = Math.hypot(dx, dy);
    if (!dragging) {
      if (g.pointerType === 'touch') {
        // 长按还没到就动了：不是长按，也不是拖——什么都不做，松手时也不算单击。
        if (distance > TOUCH_JITTER) { clearLongPress(); g.moved = true; }
        return;
      }
      if (distance < MOUSE_DRAG_THRESHOLD) return;
      beginDrag();
    }
    g.moved = true;
    setLiveOrigin(clampOrigin({ x: g.startOrigin.x + dx, y: g.startOrigin.y + dy }, size, bounds.width, bounds.height));
  }, [dragging, size, bounds.width, bounds.height, beginDrag, clearLongPress]);

  const finish = useCallback((e: ReactPointerEvent<HTMLElement>, cancelled: boolean): void => {
    const g = gesture.current;
    gesture.current = null;
    clearLongPress();
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (g === null) return;
    if (dragging && liveOrigin !== null) {
      // 松手吸附到**最近的角**（按小窗中心算），不是最近的边。
      const center = { x: liveOrigin.x + size.width / 2, y: liveOrigin.y + size.height / 2 };
      onCorner(nearestCorner(center, bounds.width, bounds.height));
    } else if (!cancelled && !g.moved) {
      onTap?.();
    }
    setDragging(false);
    setLiveOrigin(null);
  }, [dragging, liveOrigin, size, bounds.width, bounds.height, onCorner, onTap, clearLongPress]);

  return {
    origin: dragging && liveOrigin !== null ? liveOrigin : restOrigin,
    isDragging: dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e) => finish(e, false),
      onPointerCancel: (e) => finish(e, true),
    },
  };
}
