import { describe, expect, it } from 'vitest';

import type { FirstPageInput, FirstPageState } from '../src/layout/firstPage.js';
import {
  MIN_STAY_MS,
  PROMOTE_AFTER_MS,
  SWAP_COOLDOWN_MS,
  initialFirstPageState,
  reorderFirstPage,
} from '../src/layout/firstPage.js';
import { clampPage, pageCount, pageLabel, pageSlice, pagedGrid } from '../src/layout/pager.js';

/**
 * 第一页的发言人优先 + 防抖（MEETING_ROOM_DESIGN §4.2）。
 *
 * 这几条规则全是**时间闸**，而时间闸最容易写成「差不多能用」：
 * 少一条就是格子每 300ms 跳一次，多一条就是说了半天也换不上去。
 * 所以每一条各有一条用例，**三端跑同一组场景**。
 */

const FIRST_PAGE = 8;

function names(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `u${i + 1}`);
}

function input(over: Partial<FirstPageInput> & { nowMs: number }): FirstPageInput {
  return {
    uids: names(10),
    speaking: new Set<string>(),
    hasVideo: () => true,
    pinned: '',
    firstPageSize: FIRST_PAGE,
    ...over,
  };
}

/** settle 把所有人在第一页的驻留时间熬过 10 s，好让后面的用例能真的换人。 */
function settle(uids: string[] = names(10)): { state: FirstPageState; nowMs: number } {
  let state = reorderFirstPage(initialFirstPageState, input({ uids, nowMs: 0 }));
  const nowMs = MIN_STAY_MS + 1;
  state = reorderFirstPage(state, input({ uids, nowMs }));
  return { state, nowMs };
}

describe('第一页：发言人优先', () => {
  it('第一次排就是进房顺序', () => {
    const state = reorderFirstPage(initialFirstPageState, input({ nowMs: 1_000 }));
    expect(state.order).toEqual(names(10));
  });

  it('说够 1.5 s 才换进第一页', () => {
    const base = settle();
    const speaking = new Set(['u10']);

    // 刚开口：记下起点，但不换。
    const started = reorderFirstPage(base.state, input({ speaking, nowMs: base.nowMs }));
    expect(started.order.slice(0, FIRST_PAGE)).not.toContain('u10');

    // 差一点点也不换——1.4 s 的咳嗽不该把人顶上来。
    const almost = reorderFirstPage(
      started,
      input({ speaking, nowMs: base.nowMs + PROMOTE_AFTER_MS - 100 }),
    );
    expect(almost.order.slice(0, FIRST_PAGE)).not.toContain('u10');

    const promoted = reorderFirstPage(
      almost,
      input({ speaking, nowMs: base.nowMs + PROMOTE_AFTER_MS }),
    );
    expect(promoted.order.slice(0, FIRST_PAGE)).toContain('u10');
  });

  it('换走的是第一页里最久没发言的那一个', () => {
    const base = settle();
    // u3 最近说过话，u1 从没说过：该走的是 u1。
    let state = reorderFirstPage(
      base.state,
      input({ speaking: new Set(['u3']), nowMs: base.nowMs }),
    );
    const now = base.nowMs + SWAP_COOLDOWN_MS + PROMOTE_AFTER_MS;
    state = reorderFirstPage(state, input({ speaking: new Set(['u10']), nowMs: now - PROMOTE_AFTER_MS }));
    state = reorderFirstPage(state, input({ speaking: new Set(['u10']), nowMs: now }));

    const first = state.order.slice(0, FIRST_PAGE);
    expect(first).toContain('u10');
    expect(first).toContain('u3');
    expect(first).not.toContain('u1');
  });

  it('同样久没说话时，先换走没开摄像头的', () => {
    const base = settle();
    const now = base.nowMs + PROMOTE_AFTER_MS;
    let state = reorderFirstPage(
      base.state,
      input({ speaking: new Set(['u10']), nowMs: base.nowMs, hasVideo: (uid) => uid !== 'u2' }),
    );
    state = reorderFirstPage(
      state,
      input({ speaking: new Set(['u10']), nowMs: now, hasVideo: (uid) => uid !== 'u2' }),
    );
    expect(state.order.slice(0, FIRST_PAGE)).not.toContain('u2');
  });

  it('刚上第一页的人 10 s 内不会被顶掉', () => {
    const base = settle();
    // u10 先上来。
    let state = reorderFirstPage(base.state, input({ speaking: new Set(['u10']), nowMs: base.nowMs }));
    const promotedAt = base.nowMs + PROMOTE_AFTER_MS;
    state = reorderFirstPage(state, input({ speaking: new Set(['u10']), nowMs: promotedAt }));
    expect(state.order.slice(0, FIRST_PAGE)).toContain('u10');

    // 紧接着 u9 也说够了：这时第一页里只有 u10 是「新来的」，别人都熬过 10 s，
    // 所以该被换走的是别人，u10 必须还在。
    const later = promotedAt + SWAP_COOLDOWN_MS + PROMOTE_AFTER_MS;
    state = reorderFirstPage(state, input({ speaking: new Set(['u9']), nowMs: later - PROMOTE_AFTER_MS }));
    state = reorderFirstPage(state, input({ speaking: new Set(['u9']), nowMs: later }));
    expect(state.order.slice(0, FIRST_PAGE)).toContain('u10');
    expect(state.order.slice(0, FIRST_PAGE)).toContain('u9');
  });

  it('每 2 s 最多换一个人', () => {
    const base = settle();
    const both = new Set(['u9', 'u10']);
    let state = reorderFirstPage(base.state, input({ speaking: both, nowMs: base.nowMs }));
    state = reorderFirstPage(state, input({ speaking: both, nowMs: base.nowMs + PROMOTE_AFTER_MS }));

    const first = state.order.slice(0, FIRST_PAGE);
    const promoted = ['u9', 'u10'].filter((uid) => first.includes(uid));
    expect(promoted, '一轮只许换一个').toHaveLength(1);
  });

  it('钉住的人不许被换走', () => {
    const base = settle();
    const pinned = 'u1'; // 最久没发言的那个，不钉的话第一个被换
    const now = base.nowMs + PROMOTE_AFTER_MS;
    let state = reorderFirstPage(
      base.state,
      input({ speaking: new Set(['u10']), nowMs: base.nowMs, pinned }),
    );
    state = reorderFirstPage(state, input({ speaking: new Set(['u10']), nowMs: now, pinned }));
    expect(state.order.slice(0, FIRST_PAGE)).toContain('u1');
  });
});

describe('第一页：成员进出', () => {
  it('有人离开，后面的人依次前补，第一页熬上来的顺序不被打回', () => {
    const base = settle();
    const now = base.nowMs + PROMOTE_AFTER_MS;
    let state = reorderFirstPage(base.state, input({ speaking: new Set(['u10']), nowMs: base.nowMs }));
    state = reorderFirstPage(state, input({ speaking: new Set(['u10']), nowMs: now }));
    const beforeLeave = state.order.slice(0, FIRST_PAGE);

    const left = names(10).filter((uid) => uid !== 'u5');
    state = reorderFirstPage(state, input({ uids: left, nowMs: now + 1 }));

    expect(state.order).not.toContain('u5');
    expect(state.order.slice(0, FIRST_PAGE)).toEqual(
      beforeLeave.filter((uid) => uid !== 'u5').concat(
        state.order.slice(0, FIRST_PAGE).filter((uid) => !beforeLeave.includes(uid)),
      ),
    );
  });

  it('新人追加到末尾，不插队', () => {
    const base = settle();
    const state = reorderFirstPage(
      base.state,
      input({ uids: [...names(10), 'zed'], nowMs: base.nowMs + 1 }),
    );
    expect(state.order[state.order.length - 1]).toBe('zed');
  });

  it('走掉的人不留在记账里', () => {
    const base = settle();
    let state = reorderFirstPage(base.state, input({ speaking: new Set(['u3']), nowMs: base.nowMs }));
    state = reorderFirstPage(
      state,
      input({ uids: names(10).filter((uid) => uid !== 'u3'), nowMs: base.nowMs + 1 }),
    );
    expect(state.lastSpokeAt['u3']).toBeUndefined();
    expect(state.enteredAt['u3']).toBeUndefined();
  });
});

describe('分页算术', () => {
  it('一页 8 个远端，49 个远端是 7 页（每页都留一格给自己）', () => {
    expect(pageCount(49)).toBe(7);
    expect(pageCount(8)).toBe(1);
    expect(pageCount(0), '一个远端都没有也有第 1 页').toBe(1);
  });

  it('9 人以内不分页，和群通话完全一样', () => {
    expect(pagedGrid(8)).toBe(false);
    expect(pagedGrid(9)).toBe(true);
  });

  it('最后一页不满就是不满，不补也不换算', () => {
    expect(pageSlice(names(10), 1)).toEqual(['u9', 'u10']);
  });

  it('页码夹回范围内——人走光了要能收回来', () => {
    expect(clampPage(6, 2)).toBe(1);
    expect(clampPage(-1, 3)).toBe(0);
  });

  it('页码文案是 1 / N', () => {
    expect(pageLabel(0, 7)).toBe('1 / 7');
    expect(pageLabel(6, 7)).toBe('7 / 7');
  });

  it('被换下去的人回到第一页时重新起算 10 秒', () => {
    const base = settle();
    const speaking = new Set(['u10']);
    // u1 最久没说话，被 u10 顶掉。
    let state = reorderFirstPage(base.state, input({ speaking, nowMs: base.nowMs }));
    state = reorderFirstPage(
      state,
      input({ speaking, nowMs: base.nowMs + PROMOTE_AFTER_MS }),
    );
    expect(state.order.slice(0, FIRST_PAGE)).not.toContain('u1');
    expect(state.enteredAt['u1']).toBeUndefined();

    // u1 因为有人离开补位回第一页：驻留时刻要从此刻重新起算，
    // 留着旧的那一条的话他会被下一个说话的人立刻再顶掉，位置一闪就没。
    const back = base.nowMs + PROMOTE_AFTER_MS + 1;
    state = reorderFirstPage(
      state,
      // 走两个人，u1 才从第 10 位补回第一页（换位是跟第 10 位对调，不是挪一格）。
      input({ uids: names(10).filter((uid) => uid !== 'u2' && uid !== 'u3'), nowMs: back }),
    );
    expect(state.order.slice(0, FIRST_PAGE)).toContain('u1');
    expect(state.enteredAt['u1']).toBe(back);
  });
});
