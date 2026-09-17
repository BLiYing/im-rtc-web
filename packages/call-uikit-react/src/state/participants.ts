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
    isVideoPending: false,
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
 * markRinging：某人的设备开始响铃（`userRinging`）。**不是本端加的人也摆占位格**——
 * 协议 2026-09-17 起 `call.ringing` 发给通话里的所有人，A 加了 B，C 这边也要看得见 B 在响，
 * 否则 C 只会凭空收到「B 没接听」，还会再邀请一次。
 *
 * 只在群通话里摆（1v1 的对方本来就是大画面）；已经接听的人不动；
 * 标了终局还没收掉的人（被重新邀请了）清掉终局，收格子的计时器随之撤掉。
 */
export function markRinging(state: CallViewState, uid: string): CallViewState {
  if (!state.isGroup || state.phase === 'idle' || state.phase === 'ended' || state.phase === 'incoming') return state;
  const existing = state.participants.find((p) => p.uid === uid);
  if (existing === undefined) return addInvited(state, [uid]);
  if (existing.hasAccepted || existing.settled === '') return state;
  return { ...state, participants: state.participants.map((p) => (p.uid === uid ? { ...p, settled: '' } : p)) };
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

/**
 * setVideo 叠加「摄像头开没开」。**开的那一下记成等新画面**（见 `RemoteParticipant.isVideoPending`）；
 * 已经在播时再报一次开不回退成等待——否则格子会无端闪回头像。
 */
export function setVideo(state: CallViewState, uid: string, available: boolean): CallViewState {
  return withParticipant(state, uid, (p) => ({
    ...p, hasVideo: available, isVideoPending: available && (p.isVideoPending || !p.hasVideo),
  }));
}

/**
 * revealVideo 揭开某人的格子。**不走 withParticipant**：迟到的 firstVideoFrame
 * 不该把已经离开的人补回来；没在等的人原样返回，省一次重渲染。
 */
export function revealVideo(state: CallViewState, uid: string): CallViewState {
  if (!state.participants.some((p) => p.uid === uid && p.isVideoPending)) return state;
  return {
    ...state,
    participants: state.participants.map((p) => (p.uid === uid ? { ...p, isVideoPending: false } : p)),
  };
}

/** removeParticipant 把某人的格子收掉。 */
export function removeParticipant(state: CallViewState, uid: string): CallViewState {
  return { ...state, participants: state.participants.filter((p) => p.uid !== uid) };
}

/**
 * revokeLastInvited 把 `lastInvited` 里还没接听的占位格收回来，随后清空 `lastInvited`。
 *
 * 服务端拒掉「加人」这批（1202 满员 / 1407 本端不在通话里 / 1409 宿主拒绝）时用它——
 * **只收这一批**，不扫全部未接听的人：群通话里可能还有别的人在响铃（上一轮邀请、
 * 或最初呼叫时就没接的人），跟这次失败无关。已经接听的人不动（万一应答和拒绝报文岔开到达）。
 * 与 iOS `IMCallController.revokeLastInvite()` 同形。
 */
export function revokeLastInvited(state: CallViewState): CallViewState {
  if (state.lastInvited.length === 0) return state;
  const known = new Set(state.participants.map((p) => p.uid));
  const pending = new Set(
    state.participants.filter((p) => !p.hasAccepted).map((p) => p.uid),
  );
  const toRemove = state.lastInvited.filter((uid) => known.has(uid) && pending.has(uid));
  if (toRemove.length === 0) return { ...state, lastInvited: [] };
  const removeSet = new Set(toRemove);
  return {
    ...state,
    participants: state.participants.filter((p) => !removeSet.has(p.uid)),
    lastInvited: [],
  };
}

/**
 * applySpeakers 把主讲人列表叠加到成员上。
 *
 * **不在名单里的人要被清成「没在说话」**：`activeSpeakers` 是全量快照而不是增量，
 * 只加不减的话高亮会一直亮着不灭。
 *
 * **没变的部分保留原引用**（服务端 300ms 一次全量快照，多数帧里大多数人的
 * isSpeaking/volume 都没变）：单个成员没变就还是原来那个对象，整份名单没变就
 * 还是原来那个数组，`self` 没变就还是原来那个对象，**全部没变就直接返回原 `state`**——
 * `useReducer` 拿到同一个 state 引用会整体跳过这次渲染，九宫格才不用每 300ms 全部重画一遍。
 */
export function applySpeakers(
  state: CallViewState,
  speakers: readonly { uid: string; volume: number }[],
  selfUid: string,
): CallViewState {
  const volumes = new Map(speakers.map((s) => [s.uid, s.volume]));
  const selfVolume = selfUid === '' ? undefined : volumes.get(selfUid);
  const selfSpeaking = selfVolume !== undefined;
  const selfVolumeOrZero = selfVolume ?? 0;
  const self = state.self.speaking === selfSpeaking && state.self.volume === selfVolumeOrZero
    ? state.self
    // 本端也在这份名单里（服务端不区分谁是谁），但它没有对应的 participant。
    : { ...state.self, speaking: selfSpeaking, volume: selfVolumeOrZero };

  let participantsChanged = false;
  const participants = state.participants.map((p) => {
    const volume = volumes.get(p.uid);
    const isSpeaking = volume !== undefined;
    const volumeOrZero = volume ?? 0;
    if (p.isSpeaking === isSpeaking && p.volume === volumeOrZero) return p;
    participantsChanged = true;
    return { ...p, isSpeaking, volume: volumeOrZero };
  });

  if (!participantsChanged && self === state.self) return state;
  return { ...state, self, participants: participantsChanged ? participants : state.participants };
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
