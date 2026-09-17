import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import {
  MEETING_REMOTES_PER_PAGE,
  MEETING_TILES_PER_PAGE,
  clampPage,
  pageCount,
  pageLabel,
  pageSlice,
  pagedGrid,
} from '../layout/pager.js';
import { useCall } from '../useCall.js';
import { useMeetingOrder } from '../useMeetingOrder.js';
import { styles } from '../styles.js';
import { GridStage } from './GridStage.js';
import { SpeakerStage } from './SpeakerStage.js';

/** SWIPE_THRESHOLD_PX 是翻页要滑多远。太小会把「点一下」误判成翻页。 */
const SWIPE_THRESHOLD_PX = 48;

/**
 * MeetingStage 是会议房的舞台：**分页画廊**，双击钉住进演讲者视图
 * （MEETING_ROOM_DESIGN §4.1 / §4.4）。
 *
 * # 它是 GridStage 的外层容器，不是它的替代
 *
 * 设计 §3 的门控表明写着：格子组件只负责「给定一页的格子怎么排」，行为不变；
 * 分页做成外层。所以这里只做三件事——算这一页有谁、画页码、处理手势——
 * 再把那几个人交给 `GridStage`。群通话完全不经过这里。
 *
 * # ≤ 9 人时和群通话一模一样
 *
 * 没有页码、没有滑动、行列跟人数走（§4.1）。只有超过一屏才进分页模式，
 * 那时固定 3×3、**最后一页不满也不放大**。
 */
export function MeetingStage(): ReactNode {
  const { state } = useCall();
  const [page, setPage] = useState(0);
  const [pinned, setPinned] = useState('');

  const ordered = useMeetingOrder(state.participants, pinned);
  const paged = pagedGrid(ordered.length);
  const total = pageCount(ordered.length);

  /*
    **人走了要把页码收回来**：最后一页上的人全离开后页数变少，
    停在一个不存在的页上看到的是一屏只有自己的空格子，而且怎么滑都回不去。
  */
  const safePage = clampPage(page, total);
  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [safePage, page]);

  /*
    **钉住的人走了要自动取消钉住**，否则演讲者视图会一直盯着一个不在房里的 uid：
    主画面永远是头像盘，而「取消钉住」那颗按钮是唯一的出路——用户不一定找得到。
  */
  const pinnedMember = ordered.find((p) => p.uid === pinned);
  useEffect(() => {
    if (pinned !== '' && pinnedMember === undefined) setPinned('');
  }, [pinned, pinnedMember]);

  const swipe = useSwipe((delta) => {
    if (!paged) return;
    setPage((current) => clampPage(current + delta, total));
  });

  if (pinnedMember !== undefined) {
    return <SpeakerStage pinned={pinnedMember} others={ordered} onUnpin={() => setPinned('')} />;
  }
  // 人不够一页：和群通话完全一样（§4.1），连页码都不画。
  if (!paged) return <GridStage onTileActivate={setPinned} />;

  const visible = pageSlice(ordered, safePage);
  const visibleUids = new Set(visible.map((p) => p.uid));
  const offscreen = ordered.filter((p) => !visibleUids.has(p.uid));

  return (
    <div style={styles.stageSwipe} {...swipe} data-testid="meeting-stage">
      <GridStage
        participants={visible}
        // 恒按满页算行列：最后一页不满时格子和满页一样大，不放大（§4.1）。
        fixedTileCount={MEETING_TILES_PER_PAGE}
        offscreen={offscreen}
        onTileActivate={setPinned}
        badge={
          <div style={styles.pagePill} data-testid="page-indicator">
            <span style={styles.pagePillText}>{pageLabel(safePage, total)}</span>
          </div>
        }
      />
    </div>
  );
}

/**
 * useSwipe 把左右滑翻译成翻页（§4.1「翻页：左右滑动」）。
 *
 * 用 Pointer 事件而不是 Touch：鼠标拖动、触控板、触摸屏走同一条路，
 * 桌面浏览器上也翻得动。**只认横向**——竖向留给页面本身的滚动。
 */
function useSwipe(onSwipe: (delta: number) => void): {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
} {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (event) => {
      start.current = { x: event.clientX, y: event.clientY };
    },
    onPointerUp: (event) => {
      const from = start.current;
      start.current = null;
      if (from === null) return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return;
      // 左滑（dx < 0）= 看下一页。
      onSwipe(dx < 0 ? 1 : -1);
    },
  };
}

/** MEETING_PAGE_SIZE 供宿主参考：每页 9 格、8 个远端。 */
export const MEETING_PAGE_SIZE = {
  tiles: MEETING_TILES_PER_PAGE,
  remotes: MEETING_REMOTES_PER_PAGE,
} as const;
