import { describe, expect, it } from 'vitest';

import type { CallState } from '../src/state/callMachine.js';
import { initialCallContext } from '../src/state/callMachine.js';
import type { EngineContext } from '../src/state/engineMachine.js';
import { initialEngineContext, reduceEngine } from '../src/state/engineMachine.js';
import type { PublishState, RoomState, SubscribeState } from '../src/state/roomMachine.js';
import type { EmittedEvent, MachineInput, OutgoingFrame } from '../src/state/types.js';
import { loadVector } from './vectors.js';

/**
 * 房间状态机跑 `room_fsm.json` —— **四端同一份向量**。
 *
 * 这份向量跨了两台状态机（有个用例的初始态同时带 room 与 call），
 * 所以驱动的是 engine 总状态而不是单独的房间机。
 */

interface RoomStepState {
  room?: string;
  call?: string;
  publish?: Record<string, string>;
  subscribe?: Record<string, string>;
}

interface RoomStep {
  act?: { op: string; args?: Record<string, unknown> };
  recv?: { type: string; data: Record<string, unknown> };
  internal?: string;
  send?: { type: string; data?: Record<string, unknown> }[];
  emit?: { cb: string; args?: Record<string, unknown> }[];
  state?: RoomStepState;
}

interface RoomCase {
  name: string;
  self: { uid: string; device_id: string };
  initial_state: RoomStepState;
  steps: RoomStep[];
}

interface RoomVector {
  version: number;
  kind: string;
  room_states: string[];
  publish_states: string[];
  subscribe_states: string[];
  cases: RoomCase[];
}

function toInput(step: RoomStep): MachineInput {
  if (step.act !== undefined) return { kind: 'act', op: step.act.op, args: step.act.args ?? {} };
  if (step.recv !== undefined) return { kind: 'recv', type: step.recv.type, data: step.recv.data };
  if (step.internal !== undefined) return { kind: 'internal', name: step.internal };
  throw new Error('一步里必须有 act / recv / internal 之一');
}

function seed(testCase: RoomCase): EngineContext {
  const init = testCase.initial_state;
  return {
    room: {
      ...initialEngineContext.room,
      state: (init.room ?? 'idle') as RoomState,
      roomId: 'r-1',
      publish: (init.publish ?? {}) as Record<string, PublishState>,
      // 向量里的初始 publish 用 cid 作键，这里补上 cid → track_id 的映射，
      // 否则 unpublish 找不到该把哪条标成 unpublishing。
      publishTrackIds: Object.fromEntries(Object.keys(init.publish ?? {}).map((cid) => [cid, 't-7'])),
      subscribe: (init.subscribe ?? {}) as Record<string, SubscribeState>,
      remoteTracks: Object.fromEntries(
        Object.keys(init.subscribe ?? {}).map((trackId) => [
          trackId,
          { uid: 'bob', kind: 'video' as const, participantId: 'p-1' },
        ]),
      ),
    },
    call: {
      ...initialCallContext,
      state: (init.call ?? 'idle') as CallState,
      callId: 'call-1',
      roomId: 'r-1',
      connectedAtMs: init.call === 'connected' ? Date.now() - 5_000 : 0,
    },
  };
}

/** expectSubset 做子集比对（数组按序全等，标量相等）。 */
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

/**
 * assertState 比对状态。
 *
 * `room` / `call` 按字符串比；**`publish` / `subscribe` 按全等比**——
 * 它们在向量里是完整写出来的，用子集比会让「多了一条没清掉的订阅」溜过去，
 * 而那正是最容易出的错。
 */
function assertState(ctx: EngineContext, want: RoomStepState, label: string): void {
  if (want.room !== undefined) expect(ctx.room.state, `${label} 的 room`).toBe(want.room);
  if (want.call !== undefined) expect(ctx.call.state, `${label} 的 call`).toBe(want.call);
  if (want.publish !== undefined) expect(ctx.room.publish, `${label} 的 publish`).toEqual(want.publish);
  if (want.subscribe !== undefined) {
    expect(ctx.room.subscribe, `${label} 的 subscribe`).toEqual(want.subscribe);
  }
}

const vector = loadVector<RoomVector>('room_fsm.json');

describe('room_fsm.json —— 房间与 Track 状态机', () => {
  it('向量文件形状正确', () => {
    expect(vector.kind).toBe('room_fsm');
    expect(vector.version).toBe(1);
    expect(vector.cases.length).toBeGreaterThan(0);
  });

  it.each(vector.cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    let ctx = seed(testCase);

    testCase.steps.forEach((step, index) => {
      const label = `${testCase.name} 第 ${index + 1} 步`;
      const result = reduceEngine(ctx, toInput(step));
      ctx = result.state;

      expectSubset(stripSend(result.send), step.send ?? [], `${label} 的 send`);
      expectSubset(stripEmit(result.emit), step.emit ?? [], `${label} 的 emit`);
      if (step.state !== undefined) assertState(ctx, step.state, label);
    });
  });

  it('用例里的状态都在声明的集合内', () => {
    const rooms = new Set(vector.room_states);
    const pubs = new Set(vector.publish_states);
    const subs = new Set(vector.subscribe_states);
    for (const testCase of vector.cases) {
      for (const state of [testCase.initial_state, ...testCase.steps.map((s) => s.state)]) {
        if (state === undefined) continue;
        if (state.room !== undefined) expect(rooms.has(state.room), state.room).toBe(true);
        for (const v of Object.values(state.publish ?? {})) expect(pubs.has(v), v).toBe(true);
        for (const v of Object.values(state.subscribe ?? {})) expect(subs.has(v), v).toBe(true);
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
