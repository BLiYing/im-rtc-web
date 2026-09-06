/**
 * jsdom（25）没有 `PointerEvent`：testing-library 的 `fireEvent.pointerDown` 会退化成一个
 * 没有 `clientX` / `pointerType` 的裸 `Event`，小窗拖动那组用例算出来全是 NaN。
 * 这里用 `MouseEvent` 垫一个够用的版本——只补手势层读到的那几个字段。
 */
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
