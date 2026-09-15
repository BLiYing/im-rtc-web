import { describe, expect, it } from 'vitest';

import { EngineBus } from '../src/engineBus.js';

/**
 * EngineBus 的两个边界行为：
 * 1. `callCancelled` 的公开事件字段是 `uid`，但状态机内部（与一致性向量，见 call_fsm.json）
 *    仍然用线路字段名 `by`——emitMachine 要在进公开事件表这一步把它翻译过来。
 * 2. `clear()` 之后不再抛任何事件，给 `CallEngine.destroy()` 用。
 */

describe('EngineBus.emitMachine：callCancelled 的字段翻译', () => {
  it('内部 by 翻成公开事件的 uid，不残留 by', () => {
    const bus = new EngineBus();
    const seen: unknown[] = [];
    bus.on('callCancelled', (e) => seen.push(e));

    bus.emitMachine({ cb: 'onCallCancelled', args: { by: 'alice' } });

    expect(seen).toEqual([{ uid: 'alice' }]);
  });

  it('其余事件的参数只做 snake→camel，不受这条翻译影响', () => {
    const bus = new EngineBus();
    const seen: unknown[] = [];
    bus.on('callRejected', (e) => seen.push(e));

    bus.emitMachine({ cb: 'onCallRejected', args: { uid: 'bob' } });

    expect(seen).toEqual([{ uid: 'bob' }]);
  });
});

describe('EngineBus.clear：给 destroy() 用', () => {
  it('clear 之后订阅收不到任何事件；重新 on 也不会补收之前的', () => {
    const bus = new EngineBus();
    const seen: unknown[] = [];
    bus.on('error', (e) => seen.push(e));

    bus.clear();
    bus.emit('error', { code: 1, name: 'x', message: 'x' });

    expect(seen).toEqual([]);
  });
});
