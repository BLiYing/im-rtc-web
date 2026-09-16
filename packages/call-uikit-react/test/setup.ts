/**
 * jsdom（25）没有 `PointerEvent`：testing-library 的 `fireEvent.pointerDown` 会退化成一个
 * 没有 `clientX` / `pointerType` 的裸 `Event`，小窗拖动那组用例算出来全是 NaN。
 * 这里用 `MouseEvent` 垫一个够用的版本——只补手势层读到的那几个字段。
 */
import { vi } from 'vitest';

class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  // 断言：jsdom 的 window 上没有这个字段，补上去的类型不必与 lib.dom 的完全一致。
  (window as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill;
}

/**
 * jsdom（25）没有实现 `<audio>` / `<video>` 的播放：`HTMLMediaElement.prototype.play` 是
 * `notImplemented`，且**不返回 Promise**——`useRingtone` 里的 `audio.play().catch(...)` 在
 * jsdom 下会直接 `TypeError: Cannot read properties of undefined (reading 'catch')`，
 * 测试还没走到「自动播放被拦下」那条分支就先炸在别处。
 *
 * 这里把三个方法都换成不做事的 stub：`play` 恒 resolve（模拟「播放成功」这条主路径；
 * 「被拦下 reject」那条分支由需要它的用例自己临时 `mockRejectedValueOnce` 覆盖一次）；
 * `pause` / `load` 是同步方法，jsdom 原本就是空实现，这里换成 `vi.fn()` 只是为了能在用例里断言
 * 「停的时候真的调用过 pause()」。
 */
window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
window.HTMLMediaElement.prototype.pause = vi.fn();
window.HTMLMediaElement.prototype.load = vi.fn();
