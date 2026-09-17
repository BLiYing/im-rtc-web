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
  /** act 被本地拒绝时回给调用方的结果；省略 = 断言没有本地拒绝。 */
  result?: { code: number; name: string };
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
  const roomState = (init.room ?? 'idle') as RoomState;
  return {
    room: {
      ...initialEngineContext.room,
      state: roomState,
      /*
        **向量里说「初始就在房里」的，`didJoin` 也要跟着置上。**

        向量断言的是 `room` / `publish` / `subscribe` 那几个键，`didJoin` 是本端为了分辨
        「reconnecting 是从 joined 断的还是从 joining 断的」自己记的账（见 resumeRoom）。
        种子里漏掉它，`reconnect_resumed_replays_buffered_intent` 就会被当成
        「那次进房从未落地」而去重发 room.join——**是种子不完整，不是实现错了**。
      */
      didJoin: roomState !== 'idle' && roomState !== 'joining',
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
    callStartedAtMs: 0,
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
      expect(result.reject ?? null, `${label} 的 result`).toEqual(step.result ?? null);
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

/*
  订阅被拒（最常见的是 1301：与对方停推赛跑输了）不摘记账的话，R3 会把之后每次重订都当成「换层」，
  只发 room.update_layer，再也发不出 room.subscribe。发布被拒只回滚那一条（会议房）。
*/
describe('房间帧被拒的回滚', () => {
  const joined: EngineContext = {
    ...initialEngineContext,
    room: { ...initialEngineContext.room, state: 'joined', roomId: 'r-1', didJoin: true },
  };

  it('subscribe_failed 摘掉 subscribing 与层记账，重订重新发 room.subscribe', () => {
    const subscribing = reduceEngine(joined, {
      kind: 'act', op: 'subscribe', args: { track_id: 't-9', max_layer: 'h' },
    }).state;
    expect(subscribing.room.subscribe['t-9']).toBe('subscribing');

    const rolled = reduceEngine(subscribing, {
      kind: 'internal', name: 'subscribe_failed', args: { track_id: 't-9' },
    });
    expect(rolled.state.room.subscribe['t-9']).toBeUndefined();
    expect(rolled.state.room.layers['t-9']).toBeUndefined();
    expect(rolled.emit).toEqual([]);

    const again = reduceEngine(rolled.state, {
      kind: 'act', op: 'subscribe', args: { track_id: 't-9', max_layer: 'h' },
    });
    expect(again.send.map((f) => f.type)).toEqual(['room.subscribe']);
  });

  it('只动 publishing / subscribing 的那一条：已发布、已订阅的不碰', () => {
    const ctx: EngineContext = {
      ...joined,
      room: { ...joined.room, publish: { 'c-1': 'published' }, subscribe: { 't-1': 'subscribed' } },
    };
    const input: MachineInput[] = [
      { kind: 'internal', name: 'publish_failed', args: { cid: 'c-1' } },
      { kind: 'internal', name: 'subscribe_failed', args: { track_id: 't-1' } },
    ];
    for (const i of input) {
      const out = reduceEngine(ctx, i);
      expect(out.state.room.publish).toEqual({ 'c-1': 'published' });
      expect(out.state.room.subscribe).toEqual({ 't-1': 'subscribed' });
    }
  });
});
