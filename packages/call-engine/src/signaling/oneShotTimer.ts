/**
 * OneShotTimer 是「同一时刻最多挂一只」的一次性定时器。
 *
 * # 为什么抽出来
 *
 * `Reconnector` 与 `ResumeDeadline` 原先各自手写同一段样板：持有句柄、到点先置 null 再跑回调、
 * 撤销时 clear 并置 null。最容易写错的是「到点先置 null」——漏了的话回调里再排一次
 * （`Reconnector` 失败后就是这么续排的）会被「已经排着」的判断挡掉，重连就此停摆。
 * 收成一处，这条顺序只写一次。
 *
 * **不从包入口导出**：它是信令层内部的积木，不是给宿主的 API。
 *
 * 每次都直接调全局 `setTimeout` / `clearTimeout`（不在构造时缓存引用），
 * 测试里 `vi.useFakeTimers()` 装在构造之后也照样生效。
 */
export class OneShotTimer {
  private handle: ReturnType<typeof setTimeout> | null = null;

  /**
   * start 排一次，`delayMs` 后跑 `fire`。**已经排着就先撤掉旧的**（重排）。
   *
   * 要「已经排着就什么都不做」的调用方自己先看 {@link armed}——两种语义都有人要，
   * 把判断留在调用点，读代码时一眼看得出是哪一种。
   */
  start(delayMs: number, fire: () => void): void {
    this.cancel();
    this.handle = setTimeout(() => {
      // 先置空再回调：回调里可能马上再 start 一次。
      this.handle = null;
      fire();
    }, delayMs);
  }

  /** cancel 撤掉还没到点的那一只。幂等。 */
  cancel(): void {
    if (this.handle !== null) {
      clearTimeout(this.handle);
      this.handle = null;
    }
  }

  /** armed 是此刻有没有一只在等。 */
  get armed(): boolean {
    return this.handle !== null;
  }
}
