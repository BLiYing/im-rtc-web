import { describe, expect, it } from 'vitest';

import { applySpeakers } from '../src/state/participants.js';
import { initialCallView } from '../src/state/viewTypes.js';
import type { CallViewState } from '../src/state/viewTypes.js';

/**
 * 「谁在说话」改版（2026-09-09）：绿描边换成名牌里一枚图标，本端那格也显示。
 *
 * 本端不是 participant，说话状态只能单独记在 `self` 上——漏了它，
 * 「我在说话」这一格永远不亮。
 */
describe('applySpeakers', () => {
  const room = (uids: string[]): CallViewState => ({
    ...initialCallView,
    participants: uids.map((uid) => ({
      uid, hasAudio: true, hasVideo: false, isVideoPending: false, isSpeaking: false, volume: 0,
      hasAccepted: true, networkLevel: 0, settled: '' as const,
    })),
  });

  it('多人同时说话，每个格子各亮各的', () => {
    const state = applySpeakers(room(['bob', 'carol', 'dave']),
      [{ uid: 'bob', volume: 60 }, { uid: 'carol', volume: 45 }, { uid: 'dave', volume: 30 }], 'alice');

    expect(state.participants.filter((p) => p.isSpeaking).map((p) => p.uid))
      .toEqual(['bob', 'carol', 'dave']);
    expect(state.participants[1]?.volume).toBe(45);
  });

  it('本端说话单独记在 self 上', () => {
    const state = applySpeakers(room(['bob']),
      [{ uid: 'alice', volume: 70 }, { uid: 'bob', volume: 20 }], 'alice');

    expect(state.self.speaking).toBe(true);
    expect(state.self.volume).toBe(70);
    expect(state.participants[0]?.isSpeaking).toBe(true);
  });

  it('本端不在名单里就不亮', () => {
    const state = applySpeakers(room(['bob']), [{ uid: 'bob', volume: 40 }], 'alice');
    expect(state.self.speaking).toBe(false);
    expect(state.self.volume).toBe(0);
  });

  it('全量快照：名单空了，本端与远端一起灭', () => {
    let state = applySpeakers(room(['bob']),
      [{ uid: 'alice', volume: 70 }, { uid: 'bob', volume: 20 }], 'alice');
    state = applySpeakers(state, [], 'alice');

    expect(state.self.speaking).toBe(false);
    expect(state.participants.every((p) => !p.isSpeaking)).toBe(true);
  });

  /*
   * 引用稳定性（perf）：服务端 300ms 一次全量快照，多数帧里大多数人都没变化——
   * 保留原引用是 GridStage 每 300ms 全量重渲染的唯一止血办法（React.memo 靠它才有用）。
   */
  describe('引用稳定性', () => {
    it('整份快照什么都没变就返回同一个 state（useReducer 靠它 bail out）', () => {
      const before = applySpeakers(room(['bob', 'carol']), [{ uid: 'bob', volume: 40 }], 'alice');
      const after = applySpeakers(before, [{ uid: 'bob', volume: 40 }], 'alice');
      expect(after).toBe(before);
    });

    it('没变的成员保留原对象引用，变了的成员才换新对象', () => {
      const before = applySpeakers(room(['bob', 'carol']),
        [{ uid: 'bob', volume: 40 }, { uid: 'carol', volume: 10 }], 'alice');
      const after = applySpeakers(before, [{ uid: 'bob', volume: 40 }, { uid: 'carol', volume: 55 }], 'alice');

      expect(after.participants[0]).toBe(before.participants[0]); // bob 没变
      expect(after.participants[1]).not.toBe(before.participants[1]); // carol 音量变了
      expect(after.participants[1]?.volume).toBe(55);
    });

    it('没有任何成员变化时 participants 数组整体保留原引用', () => {
      const before = applySpeakers(room(['bob', 'carol']), [{ uid: 'bob', volume: 40 }], 'alice');
      // volumes 不同但落在同一个 Map 键上，isSpeaking/volume 结果与上一次相同。
      const after = applySpeakers(before, [{ uid: 'bob', volume: 40 }], 'bob');
      expect(after.participants).toBe(before.participants);
    });

    it('self 没变就保留原对象引用', () => {
      const before = applySpeakers(room(['bob']), [{ uid: 'bob', volume: 40 }], 'alice');
      const after = applySpeakers(before, [{ uid: 'bob', volume: 99 }], 'alice');
      expect(after.self).toBe(before.self); // alice 不在名单里，self 两次都是「没在说话」
      expect(after.participants).not.toBe(before.participants); // bob 音量变了，数组必须换新
    });
  });
});
