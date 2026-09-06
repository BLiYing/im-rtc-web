import type { CallViewState, RemoteParticipant, SettledOutcome } from './viewTypes.js';

/**
 * 成员列表上的叠加逻辑：进房、发言、网络、邀请中的终局。纯函数，配 `callView.test.ts`。
 */

/** newParticipant 造一个刚出现的成员。 */
export function newParticipant(uid: string, hasAccepted: boolean): RemoteParticipant {
  return {
    uid,
    // **默认认为有音频**：`userAudioAvailable` 只在状态**变化**时才抛，
    // 一开始就正常的人不会有事件——默认 false 的话所有人都显示成静音。
    hasAudio: true,
    hasVideo: false,
    isSpeaking: false,
    volume: 0,
    hasAccepted,
    networkLevel: 0,
    settled: '',
  };
}

/** withParticipant 更新一个成员；不存在时先补进来（事件比进房通知先到是常态）。 */
export function withParticipant(
  state: CallViewState,
  uid: string,
  update: (p: RemoteParticipant) => RemoteParticipant,
): CallViewState {
  const found = state.participants.some((p) => p.uid === uid);
  const list = found ? state.participants : [...state.participants, newParticipant(uid, true)];
  return { ...state, participants: list.map((p) => (p.uid === uid ? update(p) : p)) };
}

/**
 * addInvited 把主叫刚邀请的人摆成占位格（交互稿 §05 G3：被邀请的人**立刻**占一个格子）。
 * 已经在名单里的人不重复加——服务端也会拒掉重复邀请，界面别先乱。
 */
export function addInvited(state: CallViewState, uids: readonly string[]): CallViewState {
  const known = new Set(state.participants.map((p) => p.uid));
  const fresh = uids.filter((uid) => !known.has(uid)).map((uid) => newParticipant(uid, false));
  return fresh.length === 0 ? state : { ...state, participants: [...state.participants, ...fresh] };
}

/**
 * settleParticipant 给邀请中的格子标上终局。**先标不删**：
 * 拒接就跟没发生过一样地消失，主叫会以为自己没点到；停 2s 让人看见「已拒绝」再收。
 * 已接听的人收到终局（理论上不会）就直接忽略。
 */
export function settleParticipant(state: CallViewState, uid: string, outcome: SettledOutcome): CallViewState {
  return {
    ...state,
    participants: state.participants.map((p) =>
      p.uid === uid && !p.hasAccepted ? { ...p, settled: outcome } : p),
  };
}

/** removeParticipant 把某人的格子收掉。 */
export function removeParticipant(state: CallViewState, uid: string): CallViewState {
  return { ...state, participants: state.participants.filter((p) => p.uid !== uid) };
}

/**
 * applySpeakers 把主讲人列表叠加到成员上。
 *
 * **不在名单里的人要被清成「没在说话」**：`activeSpeakers` 是全量快照而不是增量，
 * 只加不减的话高亮会一直亮着不灭。
 */
export function applySpeakers(
  state: CallViewState,
  speakers: readonly { uid: string; volume: number }[],
): CallViewState {
  const volumes = new Map(speakers.map((s) => [s.uid, s.volume]));
  return {
    ...state,
    participants: state.participants.map((p) => {
      const volume = volumes.get(p.uid);
      return { ...p, isSpeaking: volume !== undefined, volume: volume ?? 0 };
    }),
  };
}

/** applyNetwork 叠加网络质量。 */
export function applyNetwork(
  state: CallViewState,
  entries: readonly { uid: string; level: number }[],
): CallViewState {
  const levels = new Map(entries.map((e) => [e.uid, e.level]));
  return {
    ...state,
    participants: state.participants.map((p) => {
      const level = levels.get(p.uid);
      return level === undefined ? p : { ...p, networkLevel: level };
    }),
  };
}

/** settledText 是占位格上终局的人话（规范 §08）。 */
export function settledText(outcome: SettledOutcome): string {
  switch (outcome) {
    case 'rejected':
      return '已拒绝';
    case 'no_answer':
      return '未接听';
    case 'offline':
      return '对方不在线';
    default:
      return '';
  }
}
