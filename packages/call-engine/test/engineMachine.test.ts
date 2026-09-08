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

/**
 * 会话没了（重连回来 `resumed=false`，或断得太久 `session_unrecoverable`）时，
 * **宿主必须拿到一个收场信号**。
 *
 * 有 call 的场合一直有 `onCallEnd(network)` 兜着，可**会议是直接 joinRoom 的、
 * 压根没有 call**：房间机悄悄回了 idle，而界面还显示着「会议中」、计时器还在走，
 * 用户完全不知道自己已经掉出去了。更糟的是一个结束类回调都没抛，engine 那边的
 * `LEAVE_CALLBACKS` 不命中、媒体面不归零，上一轮的 PeerConnection 会被带进下一次进房。
 *
 * **iOS 的 `IMRoomMachine.resume` 与 Android 的 `IMRoomMachine.resume` 是同一处漏洞。**
 */
describe('会话没了要给宿主一个收场信号', () => {
  const inMeeting = run([
    { kind: 'act', op: 'join', args: { room_id: 'r-9', room_token: 'tk' } },
    {
      kind: 'recv',
      type: 'room.join.ok',
      data: { room_id: 'r-9', participant_id: 'p-1', participants: [], tracks: [] },
    },
  ]);

  const helloNotResumed: MachineInput = {
    kind: 'recv',
    type: 'sys.hello.ok',
    data: { session_id: 's-2', resumed: false },
  };

  it('会议里重连发现会话没了：房间回 idle，并抛 onRoomLeft', () => {
    expect(inMeeting.room.state).toBe('joined');

    const result = reduceEngine(inMeeting, helloNotResumed);
    expect(result.state.room.state).toBe('idle');
    expect(result.emit.map((e) => e.cb)).toEqual(['onConnected', 'onRoomLeft']);
    expect(result.emit.at(-1)?.args).toEqual({ room_id: 'r-9' });
  });

  it('断太久（session_unrecoverable）走同一条收场路径', () => {
    const result = reduceEngine(inMeeting, { kind: 'internal', name: 'session_unrecoverable' });
    expect(result.state.room.state).toBe('idle');
    expect(result.emit.map((e) => e.cb)).toEqual(['onRoomLeft']);
  });

  /*
    有通话时**不能**补 onRoomLeft：`onCallEnd` 是所有结束分支的唯一出口（设计 §7.5），
    为同一件事抛两个回调会让宿主的记账重复一次。这条也是一致性向量
    `reconnect_not_resumed_synthesizes_call_end` 钉住的行为。
  */
  it('有通话时只抛 onCallEnd，不重复抛 onRoomLeft', () => {
    const inCall = run([
      incoming,
      { kind: 'act', op: 'accept' },
      connected,
      {
        kind: 'recv',
        type: 'room.join.ok',
        data: { room_id: 'r-1', participant_id: 'p-1', participants: [], tracks: [] },
      },
    ]);

    const result = reduceEngine(inCall, helloNotResumed);
    expect(result.emit.map((e) => e.cb)).toEqual(['onConnected', 'onCallEnd']);
  });

  it('本来就在 idle：只报连接，不凭空抛一条离房', () => {
    const result = reduceEngine(initialEngineContext, helloNotResumed);
    expect(result.emit.map((e) => e.cb)).toEqual(['onConnected']);
  });
});

/**
 * 离房被拒（1203 未在房间里、1201 房间没了…）**照样当离成功收场**。
 *
 * 不接这一条的后果比进房失败更重：房间永久停在 `leaving`，`onRoomLeft` 抛不出去，
 * 于是媒体面不归零、**摄像头指示灯一直亮**，而之后每次 join / leave 都被本地拒成 2005，
 * 除非 logout 否则再也进不了房。Android 的 `onRequestFailed` 早就接了 `ROOM_LEAVE`。
 */
describe('离房被拒也要回 idle', () => {
  it('leaving 态收到 leave_failed：回 idle 并抛 onRoomLeft', () => {
    const leaving = run([
      { kind: 'act', op: 'join', args: { room_id: 'r-9', room_token: 'tk' } },
      {
        kind: 'recv',
        type: 'room.join.ok',
        data: { room_id: 'r-9', participant_id: 'p-1', participants: [], tracks: [] },
      },
      { kind: 'act', op: 'leave' },
    ]);
    expect(leaving.room.state).toBe('leaving');

    const result = reduceEngine(leaving, { kind: 'internal', name: 'leave_failed' });
    expect(result.state.room.state).toBe('idle');
    expect(result.emit.map((e) => e.cb)).toEqual(['onRoomLeft']);
  });

  it('不在 leaving 时是空操作——迟到的失败不能把人踢出正常的房间', () => {
    const joined = run([
      { kind: 'act', op: 'join', args: { room_id: 'r-9', room_token: 'tk' } },
      {
        kind: 'recv',
        type: 'room.join.ok',
        data: { room_id: 'r-9', participant_id: 'p-1', participants: [], tracks: [] },
      },
    ]);

    const result = reduceEngine(joined, { kind: 'internal', name: 'leave_failed' });
    expect(result.state.room.state).toBe('joined');
    expect(result.emit).toEqual([]);
  });
});
