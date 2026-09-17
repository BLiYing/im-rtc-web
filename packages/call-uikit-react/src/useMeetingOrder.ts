import { useEffect, useMemo, useState } from 'react';

import type { FirstPageState } from './layout/firstPage.js';
import { initialFirstPageState, reorderFirstPage } from './layout/firstPage.js';
import { MEETING_REMOTES_PER_PAGE, pagedGrid } from './layout/pager.js';
import type { RemoteParticipant } from './state/viewTypes.js';

/**
 * REORDER_INTERVAL_MS 是重排的节拍。
 *
 * **为什么要一个节拍，而不是只在事件到达时重排**：§4.2 的三条规则全是「熬够多久」
 * （说够 1.5 s 才晋升、待满 10 s 才可能被换走、每 2 s 最多换一个）。
 * 只在事件驱动下跑的话，一个人一直在说话、成员表又没变（`applySpeakers` 没变就返回原引用），
 * 界面就再也不重排——**说了一分钟也换不上第一页**。
 *
 * 500ms 足够细（1.5 s 的判据最多晚 0.5 s 生效），又远粗于 `room.active_speakers` 的 300ms。
 */
const REORDER_INTERVAL_MS = 500;

/**
 * useMeetingOrder 给出会议画廊的**排列**：第一页是发言人优先 + 防抖，第二页起按进房顺序。
 *
 * 规则本身是纯函数（`layout/firstPage.ts`），这里只负责两件事：
 * 持有那份记账，和按节拍推它。
 *
 * **人不够一页时原样返回**：会议 ≤ 9 人与群通话长得完全一样（§4.1），
 * 那时连节拍都不起——没有第二页，也就没有「换进第一页」这回事。
 */
export function useMeetingOrder(
  participants: readonly RemoteParticipant[],
  pinned: string,
): readonly RemoteParticipant[] {
  const [order, setOrder] = useState<FirstPageState>(initialFirstPageState);
  const paged = pagedGrid(participants.length);

  /*
    `participants` 每次重排都可能是新数组，直接进依赖会让 effect 每帧重装一次定时器。
    这里只认**人**与**谁在说话**这两件事的签名——其余字段（音量、网络等级）变了不必重排。
  */
  const signature = participants
    .map((p) => `${p.uid}:${p.isSpeaking ? 1 : 0}:${p.hasVideo ? 1 : 0}`)
    .join(',');

  useEffect(() => {
    if (!paged) return;
    const step = (): void => {
      setOrder((prev) =>
        reorderFirstPage(prev, {
          uids: participants.map((p) => p.uid),
          speaking: new Set(participants.filter((p) => p.isSpeaking).map((p) => p.uid)),
          hasVideo: (uid) => participants.find((p) => p.uid === uid)?.hasVideo ?? false,
          pinned,
          firstPageSize: MEETING_REMOTES_PER_PAGE,
          nowMs: Date.now(),
        }),
      );
    };
    step(); // 立刻走一次：新人进来那一刻就该排进去，不必等下一拍
    const handle = setInterval(step, REORDER_INTERVAL_MS);
    return () => clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- participants 用 signature 代表
  }, [paged, pinned, signature]);

  return useMemo(() => {
    if (!paged) return participants;
    const byUid = new Map(participants.map((p) => [p.uid, p]));
    const sorted: RemoteParticipant[] = [];
    for (const uid of order.order) {
      const found = byUid.get(uid);
      if (found !== undefined) {
        sorted.push(found);
        byUid.delete(uid);
      }
    }
    // 排列还没跟上（刚进来的人）时兜底追加，一个都不许丢——丢了就是「有人在房里但没有格子」。
    return [...sorted, ...byUid.values()];
  }, [paged, participants, order]);
}
