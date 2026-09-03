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
