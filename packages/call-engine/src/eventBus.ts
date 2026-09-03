import type { EngineEventHandler, EngineEventName, EngineEvents } from './events.js';
import { logger } from './logger.js';

/**
 * 类型安全的事件总线。
 *
 * 不引第三方 emitter：SDK 要轻，宿主的技术栈不该被我们绑架（CONVENTIONS §11）。
 * 逻辑就这几十行。
 */
export class EventBus {
  private readonly handlers = new Map<EngineEventName, Set<(payload: never) => void>>();

  /** on 订阅一个事件，返回退订函数。 */
  on<K extends EngineEventName>(name: K, handler: EngineEventHandler<K>): () => void {
    let set = this.handlers.get(name);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as (payload: never) => void);
    return () => {
      set?.delete(handler as (payload: never) => void);
    };
  }

  /** off 退订。 */
  off<K extends EngineEventName>(name: K, handler: EngineEventHandler<K>): void {
    this.handlers.get(name)?.delete(handler as (payload: never) => void);
  }

  /**
   * emit 派发一个事件。
   *
   * **单个订阅者抛异常不能影响其他订阅者**——宿主的某个 UI 组件写崩了，
   * 不该让整个通话的事件流断掉。
   */
  emit<K extends EngineEventName>(name: K, payload: EngineEvents[K]): void {
    const set = this.handlers.get(name);
    if (set === undefined) return;
    for (const handler of [...set]) {
      try {
        (handler as EngineEventHandler<K>)(payload);
      } catch (cause) {
        logger.error('事件订阅者抛异常', { event: name, cause: String(cause) });
      }
    }
  }

  /** clear 清空全部订阅（engine 销毁时）。 */
  clear(): void {
    this.handlers.clear();
  }
}
