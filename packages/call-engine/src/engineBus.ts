import { ErrorCode, RtcError, errorName, isRtcError } from './errors.js';
import { EventBus } from './eventBus.js';
import type { EngineEventHandler, EngineEventName, EngineEvents } from './events.js';
import { MACHINE_EVENT_NAMES } from './events.js';
import { logger } from './logger.js';
import { camelizeArgs } from './signaling/caseMapping.js';
import type { EmittedEvent } from './state/types.js';

/**
 * engine 的事件出口：抛给宿主的同时**写一条日志**。
 *
 * # 为什么事件要进日志
 *
 * 出问题时最需要的一样东西是「这一通电话到底发生了什么」，而那正是公开事件表。
 * 只有宿主自己订阅才看得到的话，一次排障就得让人手动复制事件流——
 * 复制不全、顺序错乱、跟服务端日志对不上时间轴。
 * 走 `logger` 之后，宿主装一个 sink 就能把两端与服务端放在同一条时间轴上读。
 *
 * # 级别怎么定
 *
 * 按 `docs/mechanism/LOGGING.md`：info 是**状态跃迁**，一次 1v1 通话个位数条。
 * `activeSpeakers` / `networkQuality` 是服务端节流后的**周期性**事件（300ms / 2s），
 * 放 info 会把真正要看的那几条冲掉，所以降到 debug。
 */
const PERIODIC_EVENTS: ReadonlySet<EngineEventName> = new Set([
  'activeSpeakers',
  'networkQuality',
]);

export class EngineBus {
  private readonly bus = new EventBus();

  /** on 订阅事件，返回退订函数。 */
  on<K extends EngineEventName>(name: K, handler: EngineEventHandler<K>): () => void {
    return this.bus.on(name, handler);
  }

  /** emit 抛一个事件，并按级别记一条日志。 */
  emit<K extends EngineEventName>(name: K, payload: EngineEvents[K]): void {
    if (PERIODIC_EVENTS.has(name)) logger.debug(`event ${name}`, toFields(payload));
    else logger.info(`event ${name}`, toFields(payload));
    this.bus.emit(name, payload);
  }

  /** emitMachine 把状态机的 `onXxx` 翻成公开事件名，并把参数转成 camelCase。 */
  emitMachine(event: EmittedEvent): void {
    const name = MACHINE_EVENT_NAMES[event.cb];
    if (name === undefined) {
      logger.warn('状态机抛了一个没登记的回调', { cb: event.cb });
      return;
    }
    this.emit(name, camelizeArgs(event.args) as never);
  }

  /** emitError 把任意异常收敛成 error 事件。 */
  emitError(err: unknown): void {
    const error = isRtcError(err) ? err : new RtcError(ErrorCode.internal, { cause: err });
    this.emit('error', {
      code: error.code,
      name: errorName(error.code),
      message: error.message,
    });
  }
}

/**
 * toFields 把事件参数摊平成日志字段。
 *
 * 对象与数组转成 JSON 字符串：日志字段是给人 grep 的，嵌套结构在一行里读不出来，
 * 而且各家 sink 对嵌套值的处理还不一致。
 */
function toFields(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    out[key] =
      value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
  }
  return out;
}
