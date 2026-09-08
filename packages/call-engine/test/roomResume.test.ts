import { describe, expect, it } from 'vitest';

import { FrameType } from '../src/signaling/registry.js';
import type { RoomContext } from '../src/state/roomMachine.js';
import { initialRoomContext, reduceRoom, resumeRoom } from '../src/state/roomMachine.js';

/**
 * 「恢复之后到底算不算在房里」——2026-09-08 那轮跨端 review 的回归。
 *
 * `disconnected` 会把**任何**非 idle 状态推进 `reconnecting`，`joining` 也在内。
 * 而从 `joining` 断的那一种，`room.join` 当时还在飞：服务端从没受理过我们。
 * 原先 `resumeRoom` 无条件宣布 `joined`，于是本端以为自己在房里，
 * 之后每一帧都换回 1201/1203，而重新 join 又因为「不在 idle」被本地拒成 2005——
 * 一个哑掉的死局，日志里一条报错都没有。
 *
 * **本端踩得比 iOS / Android 更稳**：`handleClose` 同步调 `onDisconnected`，
 * 而 `dispatch` 头一行就同步 reduce；`rejectAll` 触发的 `join_failed` 只能等微任务。
 * 所以 `disconnected` 每次都赢，`join_failed` 必定变成空操作（它 guard 在 `joining` 上）。
 * iOS 那边是竞态，这里是稳定复现——所以判据必须认账不认时序。
 */
describe('resumeRoom：reconnecting 的两种来路', () => {
  const joined: RoomContext = {
    ...initialRoomContext,
    state: 'joined',
    didJoin: true,
    roomId: 'r-1',
    roomToken: 'rt-1',
  };

  it('从 joined 断的，恢复后回 joined 并重放攒下的意图', () => {
    let ctx = reduceRoom(joined, { kind: 'internal', name: 'disconnected' }).state;
    expect(ctx.state).toBe('reconnecting');

    ctx = reduceRoom(ctx, {
      kind: 'act',
      op: 'mute',
      args: { track_id: 't-7', muted: true },
    }).state;
    expect(ctx.buffered, 'reconnecting 期间只攒不发（不变量 R2）').toHaveLength(1);

    const result = resumeRoom(ctx, true);

    expect(result.state.state).toBe('joined');
    expect(result.send.map((f) => f.type)).toEqual([FrameType.roomMute]);
    expect(result.state.buffered, '重放完就该清空').toHaveLength(0);
  });

  it('从 joining 断的，恢复后重发 room.join 而不是假装已经在房里', () => {
    let ctx = reduceRoom(initialRoomContext, {
      kind: 'act',
      op: 'join',
      args: { room_id: 'r-9', room_token: 'rt-9' },
    }).state;
    expect(ctx.state).toBe('joining');
    expect(ctx.didJoin, '还没收到 join.ok').toBe(false);

    // 断线。join_failed 那条兜底在这里指望不上——它 guard 在 joining 上，
    // 而 disconnected 已经把状态推走了（本端的 disconnected 每次都排在前面）。
    ctx = reduceRoom(ctx, { kind: 'internal', name: 'disconnected' }).state;
    ctx = reduceRoom(ctx, { kind: 'internal', name: 'join_failed' }).state;
    expect(ctx.state).toBe('reconnecting');

    const result = resumeRoom(ctx, true);

    expect(result.state.state, '那次进房从未落地，不能宣布 joined').toBe('joining');
    expect(result.send.map((f) => f.type)).toEqual([FrameType.roomJoin]);
    expect(result.send[0]?.data).toMatchObject({
      room_id: 'r-9',
      // 房票要原样带上，不然重发也进不去。
      room_token: 'rt-9',
    });
  });

  it('重发 room.join 时攒下的意图原样留着', () => {
    let ctx = reduceRoom(initialRoomContext, {
      kind: 'act',
      op: 'join',
      args: { room_id: 'r-9', room_token: 'rt-9' },
    }).state;
    ctx = reduceRoom(ctx, {
      kind: 'act',
      op: 'publish',
      args: { cid: 'cam-1', kind: 'video' },
    }).state;
    ctx = reduceRoom(ctx, { kind: 'internal', name: 'disconnected' }).state;

    const result = resumeRoom(ctx, true);

    expect(result.state.buffered).toHaveLength(1);
    expect(result.state.buffered[0]?.op).toBe('publish');
  });

  it('auto_subscribe=false 也要原样带进重发的那一帧', () => {
    let ctx = reduceRoom(initialRoomContext, {
      kind: 'act',
      op: 'join',
      args: { room_id: 'r-9', room_token: 'rt-9', auto_subscribe: false },
    }).state;
    ctx = reduceRoom(ctx, { kind: 'internal', name: 'disconnected' }).state;

    const result = resumeRoom(ctx, true);

    expect(result.send[0]?.data).toMatchObject({ auto_subscribe: false });
  });

  it('连房号都没有时干净地回 idle，不发帧', () => {
    const ctx: RoomContext = { ...initialRoomContext, state: 'reconnecting', didJoin: false };
    const result = resumeRoom(ctx, true);
    expect(result.state.state).toBe('idle');
    expect(result.send).toHaveLength(0);
  });

  it('resumed=false 照旧无条件归零（协议 §1.4）', () => {
    const result = resumeRoom({ ...joined, state: 'reconnecting' }, false);
    expect(result.state.state).toBe('idle');
    expect(result.send).toHaveLength(0);
  });

  it('room.join.ok 是记下 didJoin 的唯一地方', () => {
    let ctx = reduceRoom(initialRoomContext, {
      kind: 'act',
      op: 'join',
      args: { room_id: 'r-9', room_token: 'rt-9' },
    }).state;
    expect(ctx.didJoin).toBe(false);

    ctx = reduceRoom(ctx, {
      kind: 'recv',
      type: `${FrameType.roomJoin}.ok`,
      data: { room_id: 'r-9', participant_id: 'p-1' },
    }).state;

    expect(ctx.didJoin, '收到 join.ok 之后才算真的进过房').toBe(true);
  });
});
