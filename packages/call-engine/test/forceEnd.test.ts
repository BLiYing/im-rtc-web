import { describe, expect, it } from 'vitest';

import type { CallContext } from '../src/state/callMachine.js';
import { initialCallContext, reduceCall } from '../src/state/callMachine.js';
import type { EngineContext } from '../src/state/engineMachine.js';
import { initialEngineContext, reduceEngine } from '../src/state/engineMachine.js';
import { forceEnd } from '../src/state/forceEnd.js';
import type { RoomState } from '../src/state/roomMachine.js';
import { initialRoomContext, reduceRoom } from '../src/state/roomMachine.js';

/**
 * 强制收场（`state/forceEnd.ts`）与「idle 下迟到的帧」。**纯函数，不需要网络。**
 *
 * 守的是 2026-09-13 14:53~14:58 iOS frank 那一场暴露出来的几件事（五端同形，iOS 的 `ForceEndTests`）：
 * · 红键的结束帧没发出去时，界面收了而 engine 还留在通话与房间里，别人一直看得见他；
 * · 收场之后才回来的 `room.join.ok` 会把一个没人要的房间捡回来，或者让服务端一直挂着这个人；
 * · 拨出中还没拿到 call_id 就收场，被叫会一直响到超时。
 */

function inCall(
  state: CallContext['state'],
  callId = 'c-1',
  room: RoomState = 'idle',
): EngineContext {
  return {
    call: { ...initialCallContext, state, callId, connectedAtMs: 1_000 },
    room: { ...initialRoomContext, state: room, roomId: room === 'idle' ? '' : 'r-1' },
    callStartedAtMs: 0,
  };
}

describe('强制收场的时长从本端进来那一刻算', () => {
  it('中途被拉进来的人：用 callStartedAtMs，不用整通电话的 connected_at_ms（10:05 frank 6 秒写成 124 秒）', () => {
    const ctx: EngineContext = { ...inCall('connected', 'c-1', 'joined'), callStartedAtMs: 119_500 };
    const out = forceEnd(ctx, 125_500);
    expect(out.emit[0]?.args['duration_sec']).toBe(6);
    expect(out.state.callStartedAtMs).toBe(0);
  });

  it('没记到本端开始时刻：退回 connected_at_ms', () => {
    const out = forceEnd(inCall('connected', 'c-1', 'joined'), 125_000);
    expect(out.emit[0]?.args['duration_sec']).toBe(124);
  });

  it('engine 在抛 onCallBegin 那一刻打点，中间推进不冲掉，call.ended 清零', () => {
    const accepting: EngineContext = {
      ...initialEngineContext,
      call: { ...initialCallContext, state: 'accepting', callId: 'c-1', role: 'callee' },
    };
    const began = reduceEngine(accepting, {
      kind: 'recv',
      type: 'call.connected',
      data: { call_id: 'c-1', room_id: 'r-1', room_token: 'rt', connected_at_ms: 1_000 },
    }, 119_000);
    expect(began.state.callStartedAtMs).toBe(119_000);

    const later = reduceEngine(began.state, { kind: 'internal', name: 'media_ready' }, 130_000);
    expect(later.state.callStartedAtMs).toBe(119_000);

    const ended = reduceEngine(later.state, {
      kind: 'recv',
      type: 'call.ended',
      data: { call_id: 'c-1', reason: 'hangup', duration_sec: 5, ended_by: 'bob' },
    }, 140_000);
    expect(ended.state.call.state).toBe('idle');
    expect(ended.state.callStartedAtMs).toBe(0);
  });
});

describe('拨出中还没拿到 call_id 就按取消', () => {
  const inviting = (): CallContext => ({ ...initialCallContext, state: 'inviting', role: 'caller' });

  it('不发帧、不报错，只把取消挂起', () => {
    const out = reduceCall(inviting(), { kind: 'act', op: 'cancel' });
    expect(out.send).toEqual([]);
    expect(out.emit).toEqual([]);
    expect(out.state.cancelPending).toBe(true);
    expect(out.state.state).toBe('inviting');
  });

  it('invite.ok 一回来立刻补发带 call_id 的 call.cancel，标记清掉', () => {
    const pending = reduceCall(inviting(), { kind: 'act', op: 'cancel' }).state;
    const out = reduceCall(pending, {
      kind: 'recv', type: 'call.invite.ok', data: { call_id: 'c-9', room_id: 'r-9' },
    });
    expect(out.send).toEqual([{ type: 'call.cancel', data: { call_id: 'c-9' } }]);
    expect(out.state.callId).toBe('c-9');
    expect(out.state.cancelPending).toBe(false);
  });

  it('有 call_id 时照旧立刻发（向量 caller_1v1_cancel）', () => {
    const out = reduceCall({ ...inviting(), callId: 'c-1' }, { kind: 'act', op: 'cancel' });
    expect(out.send).toEqual([{ type: 'call.cancel', data: { call_id: 'c-1' } }]);
    expect(out.state.cancelPending).toBe(false);
  });

  it('没按过取消时 invite.ok 不发任何帧', () => {
    const out = reduceCall(inviting(), {
      kind: 'recv', type: 'call.invite.ok', data: { call_id: 'c-9', room_id: 'r-9' },
    });
    expect(out.send).toEqual([]);
  });
});

describe('forceEnd：通话', () => {
  it('通话中：发 call.hangup，本地两台机器一起归零，抛一次 onCallEnd', () => {
    const out = forceEnd(inCall('connected', 'c-1', 'joined'), 6_500);

    expect(out.send).toEqual([{ type: 'call.hangup', data: { call_id: 'c-1' } }]);
    expect(out.state.call.state).toBe('idle');
    expect(out.state.room.state).toBe('idle');
    expect(out.emit).toEqual([
      { cb: 'onCallEnd', args: { call_id: 'c-1', reason: 'hangup', duration_sec: 5, ended_by: '' } },
    ]);
  });

  it('frank 那一刻的形状：call.connected 到了、room.join 还在路上——照样 hangup', () => {
    const out = forceEnd(inCall('connecting', 'c-1', 'joining'), 1_000);
    expect(out.send.map((f) => f.type)).toEqual(['call.hangup']);
    expect(out.state.room.state).toBe('idle');
    expect(out.state.room.buffered).toEqual([]);
  });

  it('响铃中：call.reject', () => {
    const out = forceEnd(inCall('ringing'), 1_000);
    expect(out.send.map((f) => f.type)).toEqual(['call.reject']);
    expect(out.emit[0]?.args['reason']).toBe('reject');
    expect(out.emit[0]?.args['duration_sec']).toBe(0);
  });

  it('accepting：accept 有没有落地不知道，reject 与 hangup 两帧都发', () => {
    const out = forceEnd(inCall('accepting'), 1_000);
    expect(out.send.map((f) => f.type)).toEqual(['call.reject', 'call.hangup']);
    expect(out.state.call.state).toBe('idle');
  });

  it('拨出中有 call_id：call.cancel', () => {
    const out = forceEnd(inCall('inviting', 'c-2'), 1_000);
    expect(out.send).toEqual([{ type: 'call.cancel', data: { call_id: 'c-2' } }]);
    expect(out.emit[0]?.args['reason']).toBe('cancel');
  });

  it('拨出中还没有 call_id：此刻发不了帧，但本地照样收得掉', () => {
    const out = forceEnd(inCall('inviting', ''), 1_000);
    expect(out.send).toEqual([]);
    expect(out.state.call.state).toBe('idle');
    expect(out.emit[0]?.args['reason']).toBe('cancel');
  });
});

describe('forceEnd：会议与空闲', () => {
  it('没有通话却在房里（会议）：room.leave + onRoomLeft', () => {
    const ctx: EngineContext = {
      ...initialEngineContext,
      room: { ...initialRoomContext, state: 'joined', roomId: 'r-9' },
    };
    const out = forceEnd(ctx, 1_000);
    expect(out.send).toEqual([{ type: 'room.leave', data: { room_id: 'r-9' } }]);
    expect(out.state.room.state).toBe('idle');
    expect(out.emit).toEqual([{ cb: 'onRoomLeft', args: { room_id: 'r-9' } }]);
  });

  it('什么都没有：原样返回', () => {
    const out = forceEnd(initialEngineContext, 1_000);
    expect(out.state).toBe(initialEngineContext);
    expect(out.send).toEqual([]);
    expect(out.emit).toEqual([]);
  });
});

describe('房间机 idle 下的迟到帧', () => {
  it('迟到的 room.join.ok：不认领，补发 room.leave', () => {
    const out = reduceRoom(initialRoomContext, {
      kind: 'recv',
      type: 'room.join.ok',
      data: { room_id: 'r-1', participant_id: 'r-1-p6', participants: [], tracks: [] },
    });
    expect(out.state.state).toBe('idle');
    expect(out.send).toEqual([{ type: 'room.leave', data: { room_id: 'r-1' } }]);
    expect(out.emit).toEqual([]);
  });

  it('其余房间帧一律丢弃——sub offer 不应答、成员事件不抛、leave.ok 不多抛 onRoomLeft', () => {
    const offer = reduceRoom(initialRoomContext, {
      kind: 'recv', type: 'room.offer', data: { pc: 'sub', sdp: 'v=0' },
    });
    expect(offer.send).toEqual([]);

    const joined = reduceRoom(initialRoomContext, {
      kind: 'recv', type: 'room.participant_joined', data: { uid: 'bob' },
    });
    expect(joined.emit).toEqual([]);

    const leaveOk = reduceRoom(initialRoomContext, { kind: 'recv', type: 'room.leave.ok', data: {} });
    expect(leaveOk.emit).toEqual([]);
    expect(leaveOk.state).toBe(initialRoomContext);
  });
});

describe('通话机 idle 下的迟到帧', () => {
  it('迟到的 call.invite.ok：补发 call.cancel，被叫才不会一直响到超时', () => {
    const out = reduceCall(initialCallContext, {
      kind: 'recv', type: 'call.invite.ok', data: { call_id: 'c-9', room_id: 'r-9' },
    });
    expect(out.send).toEqual([{ type: 'call.cancel', data: { call_id: 'c-9' } }]);
    expect(out.state).toBe(initialCallContext);
    expect(out.emit).toEqual([]);
  });

  it('迟到的 call.connected：补发 call.hangup，不进房、不抛 onCallBegin', () => {
    const out = reduceCall(initialCallContext, {
      kind: 'recv',
      type: 'call.connected',
      data: { call_id: 'c-9', room_id: 'r-9', room_token: 'rt' },
    });
    expect(out.send).toEqual([{ type: 'call.hangup', data: { call_id: 'c-9' } }]);
    expect(out.state).toBe(initialCallContext);
    expect(out.emit).toEqual([]);
  });

  it('其余迟到帧照旧丢弃（向量 late_frames_in_idle_are_dropped）', () => {
    const out = reduceCall(initialCallContext, {
      kind: 'recv', type: 'call.accepted', data: { call_id: 'call-old', uid: 'bob' },
    });
    expect(out.send).toEqual([]);
    expect(out.emit).toEqual([]);
  });
});
