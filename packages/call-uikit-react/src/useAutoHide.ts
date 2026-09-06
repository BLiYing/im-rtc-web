import { useCallback, useEffect, useRef, useState } from 'react';

import { callMotion } from './theme.js';

/**
 * useAutoHide 管视频通话里控制条的自动隐藏（规范 §07：3s 后淡出，任意触摸立刻恢复）。
 *
 * `enabled = false` 时永远可见（语音页、拨出中、群通话都不藏——那些页面上没有画面
 * 需要让出来）。`poke()` 在任意指针活动时调，重新计时。
 */
export function useAutoHide(enabled: boolean, delayMs = callMotion.autoHideMs): {
  readonly visible: boolean;
  readonly poke: () => void;
  readonly toggle: () => void;
} {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), delayMs);
  }, [delayMs]);

  useEffect(() => {
    if (!enabled) {
      setVisible(true);
      return;
    }
    arm();
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [enabled, arm]);

  const poke = useCallback((): void => {
    if (!enabled) return;
    setVisible(true);
    arm();
  }, [enabled, arm]);

  /** toggle 是「单击画面空白处」：显示 ↔ 隐藏。 */
  const toggle = useCallback((): void => {
    if (!enabled) return;
    setVisible((v) => {
      if (v) {
        if (timer.current !== null) clearTimeout(timer.current);
        return false;
      }
      arm();
      return true;
    });
  }, [enabled, arm]);

  return { visible, poke, toggle };
}
