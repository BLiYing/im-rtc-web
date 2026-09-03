import type { ReactNode } from 'react';

import { formatDuration } from '../format/duration.js';
import { useCall } from '../useCall.js';
import { useElapsed } from '../useElapsed.js';
import { styles } from '../styles.js';
import { VideoTile } from './VideoTile.js';

/**
 * MiniWindow 是收起后的小窗。
 *
 * 小窗里**只放主讲人**（1v1 就是对端）：小窗本来就只有一百多像素宽，
 * 塞九宫格等于九个马赛克。层上界报 `l` —— 这个尺寸给 h 层是纯浪费。
 */
export function MiniWindow(): ReactNode {
  const { state, actions } = useCall();
  const seconds = useElapsed(state.beganAtMs);
  const speaker = state.participants.find((p) => p.isSpeaking) ?? state.participants[0];

  return (
    <div
      style={styles.mini}
      onClick={() => actions.setMinimized(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') actions.setMinimized(false);
      }}
      data-testid="mini-window"
    >
      {speaker !== undefined && (
        <VideoTile
          uid={speaker.uid}
          label={speaker.uid}
          hasVideo={speaker.hasVideo}
          layer="l"
          style={{ height: 100, borderRadius: 0, border: 'none' }}
        />
      )}
      <div style={styles.miniBody}>
        <span>{formatDuration(seconds)}</span>
        <button
          type="button"
          style={{ ...styles.smallButton, padding: '2px 10px', background: '#e5484d' }}
          onClick={(e) => {
            e.stopPropagation(); // 别让点击冒泡到「展开」上
            void actions.end();
          }}
          data-testid="mini-end"
        >
          挂断
        </button>
      </div>
    </div>
  );
}
