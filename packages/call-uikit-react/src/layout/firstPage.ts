/**
 * 第一页排谁：**发言人优先 + 防抖**（MEETING_ROOM_DESIGN §4.2）。
 *
 * # 为什么是一个纯函数 + 一份状态，而不是「按说话时间排序」
 *
 * 按说话时间直接排序的话，两个人来回搭话就会让第一页每 300ms 重排一次——
 * `room.active_speakers` 本来就是 300ms 一条。用户看到的是格子不停地跳位置，
 * 谁也看不清。所以这里的每一条规则都是**防抖**：
 *
 * - **晋升要熬够 1.5 s**：咳嗽一声、椅子响一下不算发言；
 * - **待满 10 s 才可能被换走**：刚上来的人不会立刻被下一个说话的人顶掉；
 * - **每 2 s 最多换一个人**：一次换一个，位置的变化看得过来。
 *
 * # 状态为什么要外带
 *
 * 这三条规则都跟「多久以前」有关，而判据的输入只有一串 uid 和一个时刻。
 * 把时间记账放进调用方（React 的 ref / iOS 的属性），这个函数就是纯的：
 * 同样的 (state, input) 永远得到同样的 state'，三端跑同一组用例。
 *
 * # 第二页往后是稳定的
 *
 * 这里只动第一页。第二页起恒按**进房顺序**——翻到后面的人不该因为有人说话而被挪走。
 */

/** PROMOTE_AFTER_MS：连续说话多久才够格换进第一页。 */
export const PROMOTE_AFTER_MS = 1_500;

/** MIN_STAY_MS：在第一页待满这么久的人才可能被换出去。 */
export const MIN_STAY_MS = 10_000;

/** SWAP_COOLDOWN_MS：第一页每这么久最多换一个人。 */
export const SWAP_COOLDOWN_MS = 2_000;

/** FirstPageState 是这套规则的全部记账。**调用方持有它**，本模块只做纯变换。 */
export interface FirstPageState {
  /** 远端的当前排列。前 `firstPageSize` 个就是第一页。 */
  readonly order: readonly string[];
  /** uid → 这一轮连续说话是从什么时候开始的（不在说话就没有这一条）。 */
  readonly speakingSince: Readonly<Record<string, number>>;
  /** uid → 最近一次说话的时刻。从没说过话的人没有这一条。 */
  readonly lastSpokeAt: Readonly<Record<string, number>>;
  /** uid → 进入第一页的时刻，用来判「待满 10 s」。 */
  readonly enteredAt: Readonly<Record<string, number>>;
  /** 上一次换人的时刻，用来限频。 */
  readonly lastSwapAt: number;
}

/** initialFirstPageState 是还没进房时的初值。 */
export const initialFirstPageState: FirstPageState = {
  order: [],
  speakingSince: {},
  lastSpokeAt: {},
  enteredAt: {},
  lastSwapAt: 0,
};

/** FirstPageInput 是一次重排要看的全部外部事实。 */
export interface FirstPageInput {
  /** 此刻房里的远端 uid，**按进房顺序**。 */
  readonly uids: readonly string[];
  /** 此刻正在说话的人。 */
  readonly speaking: ReadonlySet<string>;
  /** 这个人开着摄像头吗。同等条件下先换走没开摄像头的。 */
  readonly hasVideo: (uid: string) => boolean;
  /** 钉住的人（空串 = 没钉）。**钉住的人不许被换走**。 */
  readonly pinned: string;
  /** 第一页放得下几个远端。 */
  readonly firstPageSize: number;
  readonly nowMs: number;
}

/**
 * reorderFirstPage 走一次规则，返回新的记账。
 *
 * 调用时机：`room.active_speakers` 到了、有人进出、以及界面自己的节拍——
 * **多调几次无害**，每一条规则都带时间闸。
 */
export function reorderFirstPage(state: FirstPageState, input: FirstPageInput): FirstPageState {
  const synced = syncMembers(state, input);
  const spoken = trackSpeaking(synced, input);
  return promote(spoken, input);
}

/**
 * syncMembers 让排列跟上房里的人。
 *
 * **有人离开时后面的人依次前补，只动那一页；新人追加到末尾**（§4.2）。
 * 直接按 `uids` 重排的话，第一页里熬上来的人会在任何一次进出时被打回进房顺序。
 */
function syncMembers(state: FirstPageState, input: FirstPageInput): FirstPageState {
  const present = new Set(input.uids);
  const kept = state.order.filter((uid) => present.has(uid));
  const known = new Set(kept);
  const added = input.uids.filter((uid) => !known.has(uid));
  const order = [...kept, ...added];

  if (order.length === state.order.length && order.every((uid, i) => uid === state.order[i])) {
    return state;
  }
  // 一开始就在第一页的人（首次进房、或补位补上来的）也要记进入时刻，
  // 否则 10 s 的驻留判据没有起点，他们会被第一个说话的人立刻顶掉。
  const enteredAt = { ...state.enteredAt };
  for (const uid of order.slice(0, input.firstPageSize)) {
    if (enteredAt[uid] === undefined) enteredAt[uid] = input.nowMs;
  }
  return { ...state, order, enteredAt: prune(enteredAt, present) };
}

/** trackSpeaking 记「这一轮连续说了多久」与「最近一次说话是什么时候」。 */
function trackSpeaking(state: FirstPageState, input: FirstPageInput): FirstPageState {
  const speakingSince: Record<string, number> = {};
  const lastSpokeAt = { ...state.lastSpokeAt };
  for (const uid of input.speaking) {
    // 上一轮就在说的接着算；刚开口的从现在起算。
    speakingSince[uid] = state.speakingSince[uid] ?? input.nowMs;
    lastSpokeAt[uid] = input.nowMs;
  }
  const present = new Set(input.uids);
  return { ...state, speakingSince, lastSpokeAt: prune(lastSpokeAt, present) };
}

/** promote 把够格的人换进第一页，一次最多一个。 */
function promote(state: FirstPageState, input: FirstPageInput): FirstPageState {
  if (input.nowMs - state.lastSwapAt < SWAP_COOLDOWN_MS) return state;

  const size = Math.max(input.firstPageSize, 0);
  const first = state.order.slice(0, size);
  const onFirst = new Set(first);

  // 候选：不在第一页、且已经连续说了 ≥ 1.5 s。多个候选时挑说得最久的那个。
  let candidate = '';
  let candidateSince = Number.POSITIVE_INFINITY;
  for (const [uid, since] of Object.entries(state.speakingSince)) {
    if (onFirst.has(uid) || !state.order.includes(uid)) continue;
    if (input.nowMs - since < PROMOTE_AFTER_MS) continue;
    if (since < candidateSince) {
      candidate = uid;
      candidateSince = since;
    }
  }
  if (candidate === '') return state;

  const victim = pickVictim(state, input, first);
  if (victim === '') return state;

  const order = [...state.order];
  const victimIndex = order.indexOf(victim);
  const candidateIndex = order.indexOf(candidate);
  // **换位置而不是插队**：插队会把第一页后半段整体挪一格，看上去像全屏重排。
  order[victimIndex] = candidate;
  order[candidateIndex] = victim;

  // 被换下去的人要**清掉**进入时刻：留着的话，等他哪天因为有人离开而补位回第一页，
  // `syncMembers` 看见这一条已存在就不补新的起点，10 s 驻留判据从那个陈旧的时刻起算
  // 早就满了——他会被下一个说话的人**立刻**顶掉，位置一闪就没。
  const enteredAt = { ...state.enteredAt, [candidate]: input.nowMs };
  delete enteredAt[victim];

  return { ...state, order, enteredAt, lastSwapAt: input.nowMs };
}

/**
 * pickVictim 挑第一页里该让位的那个：**最久没发言的**，同等条件下先换没开摄像头的。
 *
 * 只考虑**待满 10 s** 的人；钉住的人永远不动（他是被明确指定要看的）。
 * 一个都挑不出来就这一轮不换——宁可让候选多等一会儿，也不要把刚上来的人立刻顶掉。
 */
function pickVictim(
  state: FirstPageState,
  input: FirstPageInput,
  first: readonly string[],
): string {
  let victim = '';
  let victimSpoke = Number.POSITIVE_INFINITY;
  let victimHasVideo = true;
  for (const uid of first) {
    if (uid === input.pinned) continue;
    const entered = state.enteredAt[uid] ?? input.nowMs;
    if (input.nowMs - entered < MIN_STAY_MS) continue;
    // 从没说过话的排在最前面（0 比任何时刻都早）。
    const spoke = state.lastSpokeAt[uid] ?? 0;
    const hasVideo = input.hasVideo(uid);
    const better = spoke < victimSpoke || (spoke === victimSpoke && victimHasVideo && !hasVideo);
    if (!better) continue;
    victim = uid;
    victimSpoke = spoke;
    victimHasVideo = hasVideo;
  }
  return victim;
}

/** prune 把已经不在房里的人从记账里摘掉，免得这几张表随通话越长越大。 */
function prune(
  table: Readonly<Record<string, number>>,
  present: ReadonlySet<string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [uid, value] of Object.entries(table)) {
    if (present.has(uid)) out[uid] = value;
  }
  return out;
}
