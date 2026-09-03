import type { ReactNode } from 'react';

import { formatDuration } from '../format/duration.js';
import type { CallViewState } from '../state/callView.js';
import { gridDimensions, tileLayer, visibleTiles } from '../layout/grid.js';
import { useCall } from '../useCall.js';
import { useElapsed } from '../useElapsed.js';
import { styles } from '../styles.js';
import { ControlBar } from './ControlBar.js';
import { VideoTile } from './VideoTile.js';

/**
 * ActiveCall 是通话主界面：1v1 是「对端满屏 + 本端小窗」，群通话是九宫格。
 *
 * 两种形态共用一套格子与控制条，差别只在**本端放哪**——
 * 1v1 本端是浮在角上的小画面，群通话本端就是格子之一。
 * 分成两个组件的话，静音状态、发言高亮这些要维护两遍。
 */
export function ActiveCall(): ReactNode {
  const { state } = useCall();
  const seconds = useElapsed(state.beganAtMs);
  const tiles = visibleTiles(state.participants);
  // 群通话本端也占一格，1v1 不占（本端是右上角的小画面）。
  const tileCount = state.isGroup ? tiles.length + 1 : tiles.length;
  const { cols, rows } = gridDimensions(tileCount);
  const layer = tileLayer(tileCount);

  return (
    <div style={styles.overlay} data-testid="active-call">
      <div style={styles.header}>
        <div>
          <div style={styles.title}>{title(state, tiles.length)}</div>
          <div style={styles.subtitle}>{statusLine(state, seconds)}</div>
        </div>
      </div>

      <div style={styles.stage}>
        <div
          style={{
            ...styles.grid,
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}
        >
          {tiles.map((p) => (
            <VideoTile
              key={p.uid}
              uid={p.uid}
              label={p.hasAccepted ? p.uid : `${p.uid}（响铃中）`}
              hasVideo={p.hasVideo}
              hasAudio={p.hasAudio}
              isSpeaking={p.isSpeaking}
              layer={layer}
            />
          ))}
          {state.isGroup && <SelfTile inGrid />}
        </div>
        {!state.isGroup && <SelfTile inGrid={false} />}
      </div>

      <ControlBar />
    </div>
  );
}

/** SelfTile 是本端预览。群通话里是格子之一，1v1 里浮在右上角。 */
function SelfTile({ inGrid }: { readonly inGrid: boolean }): ReactNode {
  const { state, engine } = useCall();
  // 本端预览挂的是**已发布的那条摄像头轨道**；没发布时只显示头像。
  const cid = firstVideoCid(engine.state.room.publishTrackIds);
  const style = inGrid ? {} : styles.selfPreview;

  return (
    <VideoTile
      uid=""
      label="我"
      hasVideo={state.self.cameraOn && cid !== ''}
      // 本端的静音角标读的是**本端开关**，不是回调——自己的 mute 不会绕一圈发回来。
      hasAudio={state.self.micOn}
      {...(cid === '' ? {} : { localCid: cid })}
      style={style}
    />
  );
}

/**
 * firstVideoCid 找本端摄像头轨道的 cid。
 *
 * 房间状态里记的是 cid → track_id，**cid 就是本地轨道的 id**（协议 §3.2：
 * 浏览器不允许自定义 track.id）。麦克风轨道也在这张表里，
 * 所以这里只能靠「摄像头是第二条发布的」这个顺序——
 * 更准的做法是 engine 把 kind 也记进去，等回调表补上再改。
 */
function firstVideoCid(publishTrackIds: Readonly<Record<string, string>>): string {
  const cids = Object.keys(publishTrackIds);
  return cids.length >= 2 ? (cids[1] ?? '') : '';
}

function title(state: CallViewState, others: number): string {
  if (state.isMeeting) return `会议（${others + 1} 人）`;
  if (!state.isGroup) return state.peerUid || '通话中';
  return `群通话（${others + 1} 人）`;
}

function statusLine(state: CallViewState, seconds: number): string {
  if (state.hint !== '') return state.hint;
  if (state.phase === 'outgoing') return '正在呼叫…';
  if (state.phase === 'connecting') return state.isMeeting ? '正在进入会议…' : '接通中…';
  if (state.phase === 'ended') return state.isMeeting ? '已离开会议' : '通话结束';
  return formatDuration(seconds);
}
