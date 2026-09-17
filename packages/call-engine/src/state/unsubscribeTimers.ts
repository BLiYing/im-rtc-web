import { UNSUBSCRIBE_HYSTERESIS_MS } from './roomPaging.js';

/**
 * UnsubscribeTimers 是翻页退订那五秒迟滞的**定时器那一半**。
 *
 * # 为什么定时器不在状态机里
 *
 * 状态机是纯的（不变量 I4：禁止由定时器改状态），所以它只记下「这几条等着退订」
 * （`RoomContext.pendingUnsubscribe`），到点该做什么由它自己在收到内部事件时决定。
 * 这里负责把那份清单**变成真的定时器**。
 *
 * # 为什么是「对账」而不是「排一次」
 *
 * 排队的来路不止一条：翻页报 `none` 会加一条，翻回来会撤一条，人走了 / 对方关摄像头
 * 会让它凭空消失，订满 16 路时还会被提前强制退掉。让每一条来路各自记得排 / 撤定时器，
 * 总有一条会漏——漏掉撤销的表现是**翻回来看着的人五秒后突然没了画面**。
 * 所以这里每次状态推进后按清单**整体对账**：清单里有而没定时器的排上，
 * 有定时器而清单里没有的撤掉。来路再多也不用改这里。
 */
export class UnsubscribeTimers {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly onElapsed: (trackId: string) => void) {}

  /** sync 让定时器与待退订清单一致。每次状态推进后调一次。 */
  sync(pending: readonly string[]): void {
    const wanted = new Set(pending);
    for (const [trackId, handle] of this.timers) {
      if (wanted.has(trackId)) continue;
      clearTimeout(handle);
      this.timers.delete(trackId);
    }
    for (const trackId of wanted) {
      if (this.timers.has(trackId)) continue;
      this.timers.set(
        trackId,
        setTimeout(() => {
          // 先摘掉再回调：回调会推状态机，而那一轮的 sync 又会走到这里。
          this.timers.delete(trackId);
          this.onElapsed(trackId);
        }, UNSUBSCRIBE_HYSTERESIS_MS),
      );
    }
  }

  /** clear 撤掉全部定时器（离房、logout）。 */
  clear(): void {
    for (const [, handle] of this.timers) clearTimeout(handle);
    this.timers.clear();
  }

  /** armed 是此刻挂着几只，供测试断言「撤销真的做了」。 */
  get armed(): number {
    return this.timers.size;
  }
}
