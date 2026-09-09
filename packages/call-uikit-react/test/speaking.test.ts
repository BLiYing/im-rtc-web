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
      uid, hasAudio: true, hasVideo: false, isSpeaking: false, volume: 0,
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
});
