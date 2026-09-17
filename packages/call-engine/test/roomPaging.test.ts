import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../src/errors.js';
import type { RemoteTrack, RoomContext } from '../src/state/roomMachine.js';
import { initialRoomContext, reduceRoom } from '../src/state/roomMachine.js';
import { MAX_SUBSCRIBED_VIDEO } from '../src/state/roomPaging.js';
import type { MachineOutput } from '../src/state/types.js';

/**
 * 会议房按页订阅（MEETING_ROOM_DESIGN §4.3）。
 *
 * 一致性向量（`room_fsm.json` 的 `meeting_audio_auto_video_by_page` 与
 * `call_room_auto_subscribe_all_layer_only`）钉的是**正常翻页那一条线**，
 * 这里补的是向量表达不了的两件事：**16 路上限**与**翻回来撤掉迟滞**。
 */

function videoTracks(count: number): Record<string, RemoteTrack> {
  const out: Record<string, RemoteTrack> = {};
  for (let i = 1; i <= count; i += 1) {
    out[`t-${i}`] = { uid: `u${i}`, kind: 'video', participantId: `p-${i}` };
  }
  return out;
}

function meetingCtx(trackCount: number): RoomContext {
  return {
    ...initialRoomContext,
    state: 'joined',
    roomId: 'r-m',
    didJoin: true,
    autoSubscribe: 'audio',
    remoteTracks: videoTracks(trackCount),
  };
}

function layer(ctx: RoomContext, trackId: string, max: string): MachineOutput<RoomContext> {
  return reduceRoom(ctx, {
    kind: 'act',
    op: 'update_layer',
    args: { track_id: trackId, max_layer: max },
  });
}

function types(result: MachineOutput<RoomContext>): string[] {
  return result.send.map((frame) => frame.type);
}

/** subscribeAll 把前 count 条视频都订上并坐实（模拟一页一页翻过来）。 */
function subscribeAll(start: RoomContext, count: number): RoomContext {
  let ctx = start;
  for (let i = 1; i <= count; i += 1) ctx = layer(ctx, `t-${i}`, 'l').state;
  const subscribe = { ...ctx.subscribe };
  for (const key of Object.keys(subscribe)) subscribe[key] = 'subscribed';
  return { ...ctx, subscribe };
}

describe('会议房按页订阅', () => {
  it('翻走先报 none 停包，五秒后才退订', () => {
    const ctx = subscribeAll(meetingCtx(3), 1);

    const out = layer(ctx, 't-1', 'none');
    expect(types(out), '这一步只停包，不退订').toEqual(['room.update_layer']);
    expect(out.state.pendingUnsubscribe).toEqual(['t-1']);
    expect(out.state.subscribe['t-1'], '订阅关系还在').toBe('subscribed');

    const elapsed = reduceRoom(out.state, {
      kind: 'internal',
      name: 'unsubscribe_hysteresis_elapsed',
      args: { track_id: 't-1' },
    });
    expect(types(elapsed)).toEqual(['room.unsubscribe']);
    expect(elapsed.state.subscribe['t-1']).toBe('unsubscribing');
    expect(elapsed.state.pendingUnsubscribe).toEqual([]);
  });

  it('五秒内翻回来：只换层，不重协商，计时也撤掉', () => {
    const ctx = subscribeAll(meetingCtx(3), 1);
    const out = layer(layer(ctx, 't-1', 'none').state, 't-1', 'l');

    expect(types(out), '翻回来不该再订一次——那就是一次白白的重协商').toEqual([
      'room.update_layer',
    ]);
    expect(out.state.pendingUnsubscribe, '计时要撤掉').toEqual([]);
    expect(out.state.subscribe['t-1']).toBe('subscribed');

    // 计时撤掉之后，那条内部事件迟到了也不许退订。
    const late = reduceRoom(out.state, {
      kind: 'internal',
      name: 'unsubscribe_hysteresis_elapsed',
      args: {},
    });
    expect(types(late)).toEqual([]);
    expect(late.state.subscribe['t-1']).toBe('subscribed');
  });

  it('重复报 none 不会再发一遍，也不会把五秒重新拉长', () => {
    const ctx = subscribeAll(meetingCtx(3), 1);
    const once = layer(ctx, 't-1', 'none');
    const twice = layer(once.state, 't-1', 'none');
    expect(types(twice)).toEqual([]);
    expect(twice.state.pendingUnsubscribe).toEqual(['t-1']);
  });

  it('没订过的人报 none 不发任何帧', () => {
    const out = layer(meetingCtx(3), 't-2', 'none');
    expect(types(out)).toEqual([]);
    expect(out.state.pendingUnsubscribe).toEqual([]);
  });

  it('订满 16 路时，提前把最早翻走的那一条退掉腾位置', () => {
    let ctx = subscribeAll(meetingCtx(MAX_SUBSCRIBED_VIDEO + 1), MAX_SUBSCRIBED_VIDEO);
    // 翻走两条（t-1 比 t-2 早），它们都还在五秒迟滞里占着 m-line。
    ctx = layer(ctx, 't-1', 'none').state;
    ctx = layer(ctx, 't-2', 'none').state;
    expect(ctx.pendingUnsubscribe).toEqual(['t-1', 't-2']);

    const out = layer(ctx, `t-${MAX_SUBSCRIBED_VIDEO + 1}`, 'l');
    expect(types(out), '先退最早翻走的那一条，再订新的').toEqual([
      'room.unsubscribe',
      'room.subscribe',
    ]);
    expect(out.send[0]?.data).toMatchObject({ track_id: 't-1' });
    expect(out.state.pendingUnsubscribe, 't-2 还在迟滞里，没被牵连').toEqual(['t-2']);
    expect(out.reject).toBeUndefined();
  });

  it('一条都腾不出来时本地拒绝，不排队', () => {
    // 16 路全订着且一条都没翻走：这只可能是界面一次要看超过 16 路。
    const ctx = subscribeAll(meetingCtx(MAX_SUBSCRIBED_VIDEO + 1), MAX_SUBSCRIBED_VIDEO);
    const out = layer(ctx, `t-${MAX_SUBSCRIBED_VIDEO + 1}`, 'l');

    expect(types(out)).toEqual([]);
    expect(out.reject?.code).toBe(ErrorCode.invalidState);
    expect(out.state.subscribe[`t-${MAX_SUBSCRIBED_VIDEO + 1}`]).toBeUndefined();
  });

  it('人走了，排着的退订跟着摘掉', () => {
    const ctx = layer(subscribeAll(meetingCtx(3), 1), 't-1', 'none').state;
    const left = reduceRoom(ctx, {
      kind: 'recv',
      type: 'room.participant_left',
      data: { room_id: 'r-m', participant_id: 'p-1', uid: 'u1', device_id: 'd1' },
    });
    expect(left.state.pendingUnsubscribe).toEqual([]);
    expect(left.state.subscribe['t-1']).toBeUndefined();
  });
});

describe('通话房的护栏：分页那套逻辑一点都不许漏进来', () => {
  function callCtx(): RoomContext {
    return {
      ...initialRoomContext,
      state: 'joined',
      roomId: 'r-c',
      didJoin: true,
      autoSubscribe: 'all',
      remoteTracks: videoTracks(2),
      subscribe: { 't-1': 'subscribed', 't-2': 'subscribed' },
    };
  }

  it('报 none 只换层，绝不退订', () => {
    const out = layer(callCtx(), 't-1', 'none');
    expect(types(out)).toEqual(['room.update_layer']);
    expect(out.state.pendingUnsubscribe).toEqual([]);
    expect(out.state.subscribe['t-1']).toBe('subscribed');
  });

  it('迟滞计时器的内部事件到了也什么都不做', () => {
    const out = reduceRoom(callCtx(), {
      kind: 'internal',
      name: 'unsubscribe_hysteresis_elapsed',
      args: {},
    });
    expect(types(out)).toEqual([]);
    expect(out.state.subscribe).toEqual({ 't-1': 'subscribed', 't-2': 'subscribed' });
  });

  it('auto_subscribe 认不出的档位兜底成 all，不是 none', () => {
    const out = reduceRoom(initialRoomContext, {
      kind: 'act',
      op: 'join',
      args: { room_id: 'r-1', room_token: 'tk', auto_subscribe: 'video' },
    });
    expect(out.state.autoSubscribe).toBe('all');
    expect(out.send[0]?.data).toMatchObject({ auto_subscribe: 'all' });
  });
});
