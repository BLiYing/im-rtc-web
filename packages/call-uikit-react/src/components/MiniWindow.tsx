import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { formatDuration } from '../format/duration.js';
import type { PipCorner } from '../layout/pip.js';
import { isPipCorner } from '../layout/pip.js';
import { useCall } from '../useCall.js';
import { useElapsed } from '../useElapsed.js';
import { usePipDrag } from '../usePipDrag.js';
import { styles } from '../styles.js';
import { callMetrics, callMotion } from '../theme.js';
import { RemoteAudioSink } from './RemoteAudioSink.js';
import { VideoTile } from './VideoTile.js';

/**
 * MiniWindow 是收起后的页内小窗（规范 §04 / 交互稿 §03）：180 宽，视频 16:9 + 底栏（时长 + 挂断）。
 *
 * **可拖、四角吸附**，停在哪个角记在 `sessionStorage`——刷新页面后仍在原来那个角
 * （sessionStorage 是每标签页一份，不会串到别的标签页）。单击任意处展开回全屏（挂断按钮除外）。
 *
 * 小窗里**只放主讲人**（1v1 就是对端）：小窗本来就只有一百多像素宽，
 * 塞九宫格等于九个马赛克。层上界报 `l` —— 这个尺寸给 h 层是纯浪费。
 */
const CORNER_KEY = 'im-rtc.mini-corner';

export function MiniWindow(): ReactNode {
  const { state, actions } = useCall();
  const seconds = useElapsed(state.beganAtMs);
  /*
    小窗里画谁：**第一位成员，固定不动**。

    原先是「谁在说话画谁」（`find(p => p.isSpeaking) ?? participants[0]`），而
    `activeSpeakers` 是服务端每 300ms 推一次的全量快照——主讲人一换，这一格的 uid 就变，
    于是**两个人的媒体元素同时被重挂**：旧主讲人从 `<video>` 挪进一个新建的 `<audio>`、
    新主讲人从 `<audio>` 挪上 `<video>`。一个 uid 只能挂一个元素（后挂的顶掉先挂的），
    所以这不是可以两边都留着的事；而每次重挂 `srcObject` 都会让播放从头开始，
    群里来回对话时表现为持续的音频断续，界面上却看不出任何异常。

    「跟随主讲人」在一个一百多像素宽、只有一格的小窗上换来的东西很少，
    代价却是每 300ms 一次的重挂。1v1（小窗最常见的场合）本来就只有一个人，行为不变。
    iOS / Android 的浮窗也不挑主讲人。
  */
  const speaker = state.participants[0];
  const [corner, setCorner] = useState<PipCorner>(loadCorner);
  const bounds = useViewport();
  const size = { width: callMetrics.miniWidth, height: Math.round((callMetrics.miniWidth * 9) / 16) + callMetrics.miniBar };

  const drag = usePipDrag({
    size, bounds, corner,
    onCorner: (c) => { setCorner(c); saveCorner(c); },
    onTap: () => actions.setMinimized(false),
  });

  return (
    <div
      style={{
        ...styles.mini,
        left: drag.origin.x,
        top: drag.origin.y,
        ...(drag.isDragging ? styles.pipDragging : {}),
        transition: drag.isDragging ? 'none' : `left ${callMotion.snapMs}ms ease, top ${callMotion.snapMs}ms ease`,
      }}
      role="button"
      tabIndex={0}
      aria-label="通话中，点击展开"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') actions.setMinimized(false);
      }}
      data-testid="mini-window"
      data-corner={corner}
      {...drag.handlers}
    >
      {/* 小窗只画主讲人一格，其余人的声音靠隐藏元素接上，否则收起小窗就听不见他们了。 */}
      {state.participants.filter((p) => p.uid !== speaker?.uid).map((p) => (
        <RemoteAudioSink key={p.uid} uid={p.uid} />
      ))}
      {speaker !== undefined && (
        <VideoTile
          uid={speaker.uid}
          label={speaker.uid}
          hasVideo={speaker.hasVideo}
          layer="l"
          style={{ ...styles.miniVideo, pointerEvents: 'none' }}
        />
      )}
      <div style={styles.miniBody}>
        <span>{formatDuration(seconds)}</span>
        <button
          type="button"
          style={styles.miniEnd}
          onPointerDown={(e) => e.stopPropagation()} // 别让按下冒泡成拖动
          onClick={(e) => {
            e.stopPropagation(); // 别让点击冒泡到「展开」上
            void actions.end();
          }}
          data-testid="mini-end"
        >
          {state.isGroup || state.isMeeting ? '离开' : '挂断'}
        </button>
      </div>
    </div>
  );
}

/** useViewport 量视口大小（小窗的容器就是整个窗口）。 */
function useViewport(): { readonly width: number; readonly height: number } {
  const read = (): { width: number; height: number } => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = (): void => setSize(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

function loadCorner(): PipCorner {
  try {
    const raw = sessionStorage.getItem(CORNER_KEY);
    return isPipCorner(raw) ? raw : 'bottom-right';
  } catch {
    return 'bottom-right'; // 隐私模式下会抛；记不住就每次回默认角，不影响功能。
  }
}

function saveCorner(corner: PipCorner): void {
  try {
    sessionStorage.setItem(CORNER_KEY, corner);
  } catch {
    // 同上
  }
}
