import { describe, expect, it } from 'vitest';

import type { EngineContext } from '../src/state/engineMachine.js';
import { initialEngineContext, reduceEngine } from '../src/state/engineMachine.js';
import type { MachineInput } from '../src/state/types.js';

/**
 * 总状态机管的是「只有把通话与房间合起来看才说得清」的那几件事。
 *
 * 这里的用例都围绕**通话与房间之间的接线**，纯通话逻辑与纯房间逻辑分别由
 * `call_fsm.json` / `room_fsm.json` 的向量覆盖，不在这里重复。
 */

function run(inputs: MachineInput[], from: EngineContext = initialEngineContext): EngineContext {
  return inputs.reduce((ctx, input) => reduceEngine(ctx, input).state, from);
}

const connected: MachineInput = {
  kind: 'recv',
  type: 'call.connected',
  data: {
    call_id: 'call-1', room_id: 'r-1', room_token: 'tk', media_type: 'video',
    is_group: false, connected_at_ms: 1_756_876_812_000, accepted_by: 'bob',
  },
};

const incoming: MachineInput = {
  kind: 'recv',
  type: 'call.incoming',
  data: {
    call_id: 'call-1', room_id: 'r-1', caller: 'alice', callee_ids: ['bob'],
    media_type: 'video', is_group: false, timeout_sec: 30, user_data: '',
  },
};

describe('通话与房间的接线', () => {
  it('call.connected 会带着房间机一起进房', () => {
    // 不做这一步的话，房间机不知道自己正在进房，随后的 join.ok 就没人接。
    const ctx = run([incoming, { kind: 'act', op: 'accept' }, connected]);
    expect(ctx.room.state).toBe('joining');
    expect(ctx.room.roomId).toBe('r-1');
    expect(ctx.room.roomToken).toBe('tk');
  });

  /*
    下面这条是**浏览器双开时抓到的真 bug**。

    `call.ended` 之后服务端就把房间销毁了，而房间机原本还停在 joined，于是：
      · 之后每一帧都发向一个不存在的房间，服务端回一串 1201 room_not_found；
      · 下一次 joinRoom 因为「不在 idle」被本地拒掉，界面永远停在「接通中」。
    两个症状都不报错，只在服务端日志里看得见。
  */
  it('call.ended 之后房间必须回 idle——服务端那边它已经没了', () => {
    const joined = run([
      incoming,
      { kind: 'act', op: 'accept' },
      connected,
      {
        kind: 'recv',
        type: 'room.join.ok',
        data: { room_id: 'r-1', participant_id: 'p-1', participants: [], tracks: [] },
      },
    ]);
    expect(joined.room.state).toBe('joined');

    const ended = run(
      [{
        kind: 'recv',
        type: 'call.ended',
        data: { call_id: 'call-1', reason: 'hangup', duration_sec: 201, ended_by: 'alice' },
      }],
      joined,
    );
    expect(ended.room.state).toBe('idle');
    expect(ended.room.roomId).toBe('');
    // 记账也要清干净，否则下一通会显示上一通的人。
    expect(ended.room.remoteTracks).toEqual({});
  });

  it('通话结束后能立刻进另一个房间（会议）', () => {
    const afterCall = run([
      incoming,
      { kind: 'act', op: 'accept' },
      connected,
      {
        kind: 'recv',
        type: 'call.ended',
        data: { call_id: 'call-1', reason: 'hangup', duration_sec: 1, ended_by: 'alice' },
      },
    ]);
    const result = reduceEngine(afterCall, {
      kind: 'act',
      op: 'join',
      args: { room_id: 'r-9', room_token: 'tk9' },
    });
    expect(result.state.room.state).toBe('joining');
    expect(result.send.map((f) => f.type)).toEqual(['room.join']);
  });

  it('结束不重复抛：只有一个 onCallEnd，房间不额外抛 onRoomLeft', () => {
    // onCallEnd 是所有结束分支的唯一出口（设计 §7.5）。
    // 为同一件事再抛一个 onRoomLeft 会让宿主的通话记账重复。
    const joined = run([incoming, { kind: 'act', op: 'accept' }, connected]);
    const out = reduceEngine(joined, {
      kind: 'recv',
      type: 'call.ended',
      data: { call_id: 'call-1', reason: 'hangup', duration_sec: 1, ended_by: 'alice' },
    });
    expect(out.emit.map((e) => e.cb)).toEqual(['onCallEnd']);
    expect(out.send).toEqual([]);
  });
});
