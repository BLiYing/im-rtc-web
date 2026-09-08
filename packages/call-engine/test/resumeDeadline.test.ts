import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GIVE_UP_GRACE_SEC,
  RESUME_WINDOW_SEC,
  ResumeDeadline,
  SERVER_DEATH_PINGS,
  giveUpDelayMs,
} from '../src/signaling/resumeDeadline.js';
import { initialEngineContext, reduceEngine } from '../src/state/engineMachine.js';

/*
  「断得太久 → 服务端那一侧的会话已经没了」这条倒计时。

  守的是真机 2026-09-08 的一幕：断网后停在「正在重连」，**不接网就永远停在通话界面，
  连挂断都点不动**——本地放弃的唯一入口是「重连上了但 resumed=false」，
  而网络不回来那一刻永远不会到。
*/
describe('恢复窗口倒计时', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /*
    **上界不能拍脑袋取 30 秒。** 服务端那 30 秒不是从我们断开算起，是从**它自己察觉**算起，
    而它要连续 3 个心跳周期收不到东西才察觉（§1.3）。按默认 15 秒心跳，
    最晚到期是断开后 3×15 + 30 = 75 秒。

    取短了就会撒谎：真机上断开 14 秒后重连**成功恢复**，通话好端端地继续；
    提前宣布结束等于杀掉一通还能救回来的电话，而且服务端仍认为他在房里。
  */
  it('上界覆盖服务端读超时 + 恢复窗口', () => {
    expect(giveUpDelayMs(15)).toBe(
      (SERVER_DEATH_PINGS * 15 + RESUME_WINDOW_SEC + GIVE_UP_GRACE_SEC) * 1000,
    );
    expect(giveUpDelayMs(15)).toBeGreaterThan((RESUME_WINDOW_SEC + SERVER_DEATH_PINGS * 15) * 1000 - 1);
  });

  it('跟着服务端给的心跳周期走', () => {
    const deadline = new ResumeDeadline(() => undefined);
    deadline.connected(5);
    expect(giveUpDelayMs(5)).toBeLessThan(giveUpDelayMs(15));
  });

  it('到点了报会话不可恢复', () => {
    const fired = vi.fn();
    const deadline = new ResumeDeadline(fired);
    deadline.connected(15);
    deadline.arm();

    vi.advanceTimersByTime(giveUpDelayMs(15) - 1);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  /*
    **每次重连失败都重排的话，截止时刻就一直往后挪、永远不会到**——
    而那正是这条倒计时要治的病。起点必须是第一次断开的那一刻。
    生产里退避封顶 30 秒 < 80 秒，重排就等于这条闸从来不会合上。
  */
  it('重连一直失败不许把截止时刻往后推', () => {
    const fired = vi.fn();
    const deadline = new ResumeDeadline(fired);
    deadline.connected(15);

    const total = giveUpDelayMs(15);
    for (let elapsed = 0; elapsed < total; elapsed += 5_000) {
      deadline.arm(); // 每次重连失败都会调到
      vi.advanceTimersByTime(5_000);
    }
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('连上了就撤掉', () => {
    const fired = vi.fn();
    const deadline = new ResumeDeadline(fired);
    deadline.connected(15);
    deadline.arm();

    vi.advanceTimersByTime(1_000);
    deadline.connected(15); // 重连成功
    vi.advanceTimersByTime(giveUpDelayMs(15) * 2);
    expect(fired).not.toHaveBeenCalled();
  });

  it('cancel 之后不再响，且可重复调用', () => {
    const fired = vi.fn();
    const deadline = new ResumeDeadline(fired);
    deadline.connected(15);
    deadline.arm();
    deadline.cancel();
    deadline.cancel();
    vi.advanceTimersByTime(giveUpDelayMs(15) * 2);
    expect(fired).not.toHaveBeenCalled();
    expect(deadline.armed).toBe(false);
  });
});

/*
  状态机这一半：收到 `session_unrecoverable` 要**本地合成终局**。
  与「重连上了但 resumed=false」走同一段逻辑，差别只在不必等重连成功。
*/
describe('会话不可恢复时本地收场', () => {
  it('房间归零，并合成一条 onCallEnd(network)', () => {
    const placed = reduceEngine(initialEngineContext, {
      kind: 'act',
      op: 'call',
      args: { callee_ids: ['bob'], media_type: 'audio', is_group: false },
    });
    expect(placed.state.call.state).not.toBe('idle');

    const out = reduceEngine(placed.state, { kind: 'internal', name: 'session_unrecoverable' });

    expect(out.state.call.state).toBe('idle');
    expect(out.state.room.state).toBe('idle');
    const ends = out.emit.filter((e) => e.cb === 'onCallEnd');
    expect(ends).toHaveLength(1);
    expect(ends[0]?.args.reason).toBe('network');
  });

  /** 本来就没有通话时是空操作——**不许凭空抛一条 onCallEnd**。 */
  it('idle 时保持安静', () => {
    const out = reduceEngine(initialEngineContext, {
      kind: 'internal',
      name: 'session_unrecoverable',
    });
    expect(out.emit.filter((e) => e.cb === 'onCallEnd')).toHaveLength(0);
  });
});
