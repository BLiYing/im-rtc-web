import { describe, expect, it } from 'vitest';

import type { CallContext, CallState } from '../src/state/callMachine.js';
import { initialCallContext, reduceCall } from '../src/state/callMachine.js';
import type { EmittedEvent, MachineInput, OutgoingFrame } from '../src/state/types.js';
import { loadVector } from './vectors.js';

/**
 * 通话状态机跑 `call_fsm.json` —— **四端同一份向量**。
 *
 * 向量的铁律：**某步没写 send / emit 就是断言为空**。多抛一次 onCallEnd 会被抓到。
 */

interface FsmStep {
  act?: { op: string; args?: Record<string, unknown> };
  recv?: { type: string; data: Record<string, unknown> };
  internal?: string;
  send?: { type: string; data?: Record<string, unknown> }[];
  emit?: { cb: string; args?: Record<string, unknown> }[];
  state?: string;
}

interface FsmCase {
  name: string;
  description?: string;
  role: string;
  self: { uid: string; device_id: string };
  initial_state: string;
  context?: { call_id?: string; room_id?: string; is_group?: boolean };
  steps: FsmStep[];
}

interface FsmVector {
  version: number;
  kind: string;
  states: string[];
  cases: FsmCase[];
}

function toInput(step: FsmStep): MachineInput {
  if (step.act !== undefined) {
    return { kind: 'act', op: step.act.op, args: step.act.args ?? {} };
  }
  if (step.recv !== undefined) {
    return { kind: 'recv', type: step.recv.type, data: step.recv.data };
  }
  if (step.internal !== undefined) {
    return { kind: 'internal', name: step.internal };
  }
  throw new Error('一步里必须有 act / recv / internal 之一');
}

/** expectSubset 做子集比对：向量写了哪些键就只比哪些键。 */
function expectSubset(actual: unknown, want: unknown, path: string): void {
  if (Array.isArray(want)) {
    expect(Array.isArray(actual), `${path} 应当是数组`).toBe(true);
    const got = actual as unknown[];
    expect(got.length, `${path} 长度`).toBe(want.length);
    want.forEach((item, i) => expectSubset(got[i], item, `${path}[${i}]`));
    return;
  }
  if (want !== null && typeof want === 'object') {
    const got = actual as Record<string, unknown>;
    for (const [key, value] of Object.entries(want)) {
      expect(Object.hasOwn(got, key), `${path}.${key} 应当存在`).toBe(true);
      expectSubset(got[key], value, `${path}.${key}`);
    }
    return;
  }
  expect(actual, path).toEqual(want);
}

function seedContext(testCase: FsmCase): CallContext {
  const ctx: CallContext = {
    ...initialCallContext,
    state: testCase.initial_state as CallState,
    role: testCase.role === 'caller' ? 'caller' : testCase.role === 'callee' ? 'callee' : '',
  };
  if (testCase.context === undefined) return ctx;
  return {
    ...ctx,
    callId: testCase.context.call_id ?? '',
    roomId: testCase.context.room_id ?? '',
    isGroup: testCase.context.is_group ?? false,
  };
}

const vector = loadVector<FsmVector>('call_fsm.json');

describe('call_fsm.json —— 通话状态机', () => {
  it('向量文件形状正确', () => {
    expect(vector.kind).toBe('call_fsm');
    expect(vector.version).toBe(1);
    expect(vector.cases.length).toBeGreaterThan(0);
  });

  it.each(vector.cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    let ctx = seedContext(testCase);

    testCase.steps.forEach((step, index) => {
      const label = `${testCase.name} 第 ${index + 1} 步`;
      const result = reduceCall(ctx, toInput(step));
      ctx = result.state;

      // 省略即断言为空——这条是向量的价值所在。
      const wantSend = step.send ?? [];
      const wantEmit = step.emit ?? [];
      expectSubset(stripSend(result.send), wantSend, `${label} 的 send`);
      expectSubset(stripEmit(result.emit), wantEmit, `${label} 的 emit`);

      if (step.state !== undefined) {
        expect(ctx.state, `${label} 之后的状态`).toBe(step.state);
      }
    });
  });

  it('每个用例的状态都在声明的集合内', () => {
    const allowed = new Set(vector.states);
    for (const testCase of vector.cases) {
      expect(allowed.has(testCase.initial_state), testCase.initial_state).toBe(true);
      for (const step of testCase.steps) {
        if (step.state !== undefined) expect(allowed.has(step.state), step.state).toBe(true);
      }
    }
  });
});

function stripSend(frames: readonly OutgoingFrame[]): { type: string; data: unknown }[] {
  return frames.map((f) => ({ type: f.type, data: f.data }));
}

function stripEmit(events: readonly EmittedEvent[]): { cb: string; args: unknown }[] {
  return events.map((e) => ({ cb: e.cb, args: e.args }));
}

describe('发起呼叫被服务端拒掉', () => {
  /**
   * **不回 idle 的后果是「永远退不出去」**：界面停在「正在呼叫…」，
   * 而服务端根本没建这通电话，之后每次挂断都换回 1401 call_not_found。
   * （实测：群呼把主叫自己放进了 callee_ids，服务端回 1004，然后连点五次挂断全是 1401。）
   */
  it('call_failed 把通话机退回 idle 并抛唯一的结束出口', () => {
    const placed = reduceCall(initialCallContext, {
      kind: 'act',
      op: 'call',
      args: { callee_ids: ['bob'], media_type: 'audio', is_group: false },
    });
    expect(placed.state.state).toBe('inviting');

    const failed = reduceCall(placed.state, { kind: 'internal', name: 'call_failed' });
    expect(failed.state.state).toBe('idle');
    expect(failed.emit.map((e) => e.cb)).toEqual(['onCallEnd']);
    expect(failed.emit[0]?.args['reason']).toBe('error');
    expect(failed.emit[0]?.args['duration_sec']).toBe(0);
  });

  it('已经 idle 时 call_failed 什么都不做——不能凭空造一条结束事件', () => {
    const result = reduceCall(initialCallContext, { kind: 'internal', name: 'call_failed' });
    expect(result.state.state).toBe('idle');
    expect(result.emit).toEqual([]);
  });

  it('退回 idle 之后可以重新发起——这才是「退得出去」的证据', () => {
    const placed = reduceCall(initialCallContext, {
      kind: 'act', op: 'call',
      args: { callee_ids: ['bob'], media_type: 'audio', is_group: false },
    });
    const failed = reduceCall(placed.state, { kind: 'internal', name: 'call_failed' });
    const again = reduceCall(failed.state, {
      kind: 'act', op: 'call',
      args: { callee_ids: ['carol'], media_type: 'audio', is_group: false },
    });
    expect(again.state.state).toBe('inviting');
    expect(again.send.map((f) => f.type)).toEqual(['call.invite']);
  });
});
