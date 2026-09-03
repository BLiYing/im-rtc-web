import { useEffect, useState } from 'react';

import { elapsedSec } from './format/duration.js';

/**
 * useElapsed 每秒返回一次已通话秒数。
 *
 * **计时器放 hook 不放 reducer**：reducer 要保持纯（能被逐条驱动测），
 * 而「现在几点」是副作用。`beganAtMs` 为 0（还没接通）时不起计时器。
 */
export function useElapsed(beganAtMs: number): number {
  const [seconds, setSeconds] = useState(() => elapsedSec(beganAtMs, Date.now()));

  useEffect(() => {
    if (beganAtMs <= 0) {
      setSeconds(0);
      return;
    }
    setSeconds(elapsedSec(beganAtMs, Date.now()));
    const timer = setInterval(() => setSeconds(elapsedSec(beganAtMs, Date.now())), 1000);
    return () => clearInterval(timer);
  }, [beganAtMs]);

  return seconds;
}
