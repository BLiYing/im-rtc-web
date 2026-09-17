import { MAX_REMOTE_TILES, MAX_TILES } from './grid.js';

/**
 * 会议分页画廊的**纯算术**（MEETING_ROOM_DESIGN §4.1）。
 *
 * 分页是 `GridStage` 的**外层容器**：这里只回答「这一页该放哪几个人」，
 * 格子怎么排仍然是 `grid.ts` 的事，组件本身一行不用改。群通话上限 9 人，
 * 永远只有一页，走的还是老路径。
 */

/** MEETING_TILES_PER_PAGE 是会议每页几格。**自己占第一格**，所以远端只剩 8 个位置。 */
export const MEETING_TILES_PER_PAGE = MAX_TILES;

/** MEETING_REMOTES_PER_PAGE 是每页放得下几个远端。 */
export const MEETING_REMOTES_PER_PAGE = MAX_REMOTE_TILES;

/**
 * pageCount 算总页数，**至少 1**（一个远端都没有时也有「第 1 页」，上面只有自己）。
 *
 * 每页都留一格给自己，所以 49 个远端是 7 页而不是 6 页——这是「自己恒在第一格」
 * 那条规则的代价，与群通话保持一致，不给翻页另立一套。
 */
export function pageCount(remoteCount: number, perPage = MEETING_REMOTES_PER_PAGE): number {
  if (perPage <= 0) return 1;
  return Math.max(1, Math.ceil(remoteCount / perPage));
}

/** clampPage 把页码夹回 [0, total-1]。人走了导致页数变少时要用它收回来。 */
export function clampPage(page: number, total: number): number {
  return Math.min(Math.max(page, 0), Math.max(total - 1, 0));
}

/**
 * pageSlice 取某一页的远端。
 *
 * **最后一页不满时不补、也不放大**：格子和满页一样大，从左上往下排。
 * 放大的话层会从 l 跳到 m、还要多等一次关键帧，翻页时整屏重排（§4.1）。
 * 这里只负责切片，「不放大」由 `GridStage` 恒按满页算行列来保证。
 */
export function pageSlice<T>(
  items: readonly T[],
  page: number,
  perPage = MEETING_REMOTES_PER_PAGE,
): readonly T[] {
  if (perPage <= 0) return items;
  const start = page * perPage;
  return items.slice(start, start + perPage);
}

/**
 * pagedGrid 报告这个房间此刻要不要分页。
 *
 * **总人数 ≤ 9 时和群通话完全一样**：行列跟人数走，没有页码、没有滑动。
 * 只有超过一屏才进分页模式（§4.1）。
 */
export function pagedGrid(remoteCount: number, perPage = MEETING_REMOTES_PER_PAGE): boolean {
  return remoteCount > perPage;
}

/** pageLabel 是底部页码，`1 / 7` 这样。它**取代**了 M1 的「还有 N 人未显示」胶囊（§4.5）。 */
export function pageLabel(page: number, total: number): string {
  return `${Math.min(page + 1, total)} / ${total}`;
}
