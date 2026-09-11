import { logger } from '@im-rtc/call-engine';
import { useEffect, useRef } from 'react';

import type { RemoteParticipant, ViewAction } from './state/viewTypes.js';

/**
 * VIDEO_REVEAL_FALLBACK_MS 是「等新画面上屏」最多等多久，到点照样揭示格子。
 * 与 Android `IMKitListener.REVEAL_FALLBACK_MS` 同值。
 */
export const VIDEO_REVEAL_FALLBACK_MS = 2_000;

/**
 * useVideoRevealFallback 给「摄像头开了、新画面还没上屏」的格子兜底：等太久就照样揭开。
 *
 * **为什么要兜底**：engine 靠 `requestVideoFrameCallback` 报新画面上屏，而页面在后台时
 * 浏览器不出帧，回调可能很久都不来；对端开了摄像头却迟迟不发关键帧也是同一个样子。
 * 不兜底的话格子会一直盖着头像，比「闪一下」更糟。
 *
 * 计时器按 uid 各算各的，写法与 `CallProvider` 里的 `settledTimers` 同一个：
 * 依赖看**内容签名**不看 length（CONVENTIONS §5），不再等的人（画面到了 / 又关了 / 离开了）撤掉计时器。
 */
export function useVideoRevealFallback(
  participants: readonly RemoteParticipant[],
  dispatch: (action: ViewAction) => void,
): void {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingUids = participants.filter((p) => p.isVideoPending).map((p) => p.uid).join(',');

  useEffect(() => {
    const wanted = new Set(pendingUids === '' ? [] : pendingUids.split(','));
    const running = timers.current;
    for (const [uid, timer] of running) {
      if (wanted.has(uid)) continue;
      clearTimeout(timer);
      running.delete(uid);
    }
    for (const uid of wanted) {
      if (running.has(uid)) continue;
      running.set(uid, setTimeout(() => {
        running.delete(uid);
        logger.warn('新画面迟迟没上屏，到点照样揭示', { uid, wait_ms: VIDEO_REVEAL_FALLBACK_MS });
        dispatch({ type: 'videoRevealed', uid });
      }, VIDEO_REVEAL_FALLBACK_MS));
    }
  }, [pendingUids, dispatch]);

  // 卸载时把还没到点的计时器清干净（CONVENTIONS §5：成对清理）。
  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);
}
