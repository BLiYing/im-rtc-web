import { useEffect, useRef } from 'react';

/**
 * useKeyedTimers 是「按 id 内容签名 diff 的可取消定时器 Map」——`CallProvider` 的
 * `settledTimers`（邀请中格子的终局停 2s 再收）与 `useVideoRevealFallback`
 * （摄像头开了但新画面迟迟不上屏，等太久就照样揭示）是同一套写法，抽成这一个内部 hook。
 *
 * **不从包入口导出**：这是实现细节，不是公开 API。
 *
 * - `idsSignature` 是当前「该有计时器」的那批 id，**逗号拼接的内容签名**，不是数组
 *   （CONVENTIONS §5：依赖看内容签名不看 length——定长集合的 length 恒定，
 *   靠它触发的 effect 永远不重跑）。调用方自己算这份签名，因为「谁该有计时器」的判据
 *   （`settled !== ''` / `isVideoPending`）每处都不一样。
 * - 不再需要计时器的 id（已经不在签名里）立刻撤销；新出现的 id 才起新计时器——
 *   **已经在跑的不重新计时**，这是「先拒的人反而更快被收走」那类 bug 的止血点。
 * - `onFire` 走 `useRef`，不进 `useEffect` 依赖（CONVENTIONS §5：回调型 prop 不能进 deps，
 *   否则每次渲染新建的闭包会让 effect 无意义地重跑）。
 */
export function useKeyedTimers(
  idsSignature: string,
  delayMs: number,
  onFire: (id: string) => void,
): void {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;

  useEffect(() => {
    const wanted = new Set(idsSignature === '' ? [] : idsSignature.split(','));
    const running = timers.current;
    for (const [id, timer] of running) {
      if (wanted.has(id)) continue;
      clearTimeout(timer);
      running.delete(id);
    }
    for (const id of wanted) {
      if (running.has(id)) continue;
      running.set(id, setTimeout(() => {
        running.delete(id);
        onFireRef.current(id);
      }, delayMs));
    }
  }, [idsSignature, delayMs]);

  // 卸载时把还没到点的计时器清干净（CONVENTIONS §5：成对清理）。
  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);
}
