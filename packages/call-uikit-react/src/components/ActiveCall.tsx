import type { ReactNode } from 'react';

import { formatDuration } from '../format/duration.js';
import type { CallViewState } from '../state/callView.js';
import { cellSide, gridDimensions, tileLayer, visibleTiles } from '../layout/grid.js';
import { useElementSize } from '../useElementSize.js';
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
/** 格子间距（px）。与 `styles.grid` 的 gap 是同一个数，算边长时要减掉它。 */
const TILE_GAP = 8;

export function ActiveCall(): ReactNode {
  const { state } = useCall();
  const seconds = useElapsed(state.beganAtMs);
  const stage = useElementSize<HTMLDivElement>();
  const tiles = visibleTiles(state.participants);
  // 群通话本端也占一格，1v1 不占（本端是右上角的小画面）。
  const tileCount = state.isGroup ? tiles.length + 1 : tiles.length;
  /*
    行列**跟着容器形状走**，不是只看人数：竖屏（手机、窄窗口）上两个人要上下摞，
    横屏上才是左右排。量不到尺寸时（jsdom、首帧）按正方形容器算，
    退化成老的 `ceil(sqrt(n))`——不至于渲染不出来。
  */
  const aspect = stage.height > 0 ? stage.width / stage.height : 1;
  const { cols, rows } = gridDimensions(tileCount, aspect);
  const side = cellSide({ cols, rows }, stage.width, stage.height, TILE_GAP);
  const layer = tileLayer(tileCount);

  return (
    <div style={styles.overlay} data-testid="active-call">
      <div style={styles.header}>
        <div>
          <div style={styles.title}>{title(state, tiles.length)}</div>
          <div style={styles.subtitle}>{statusLine(state, seconds)}</div>
        </div>
      </div>

      <div style={styles.stage} ref={stage.ref}>
        <div
          style={{
            ...styles.grid,
            // **格子恒为正方形**：让它吃满整块区域的话，竖屏两个人就是
            // 两条又高又窄的长条，画面被拉伸得很难看。算不出边长时退回 1fr。
            gridTemplateColumns: side > 0 ? `repeat(${cols}, ${side}px)` : `repeat(${cols}, 1fr)`,
            gridTemplateRows: side > 0 ? `repeat(${rows}, ${side}px)` : `repeat(${rows}, 1fr)`,
            gap: TILE_GAP,
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
  const { state } = useCall();
  /*
    本端预览挂的是 **`startLocalPreview` 起的那条摄像头轨道**，不是「已发布的那条」。

    原先靠「`publishTrackIds` 里的第二条就是摄像头」这个顺序去猜，而**拨出中
    根本还没有房间、没有发布**——于是视频呼出时永远看不见自己，
    要等对方接了才突然出现。（iOS 侧同一条修法：采集与发布拆成两件事。）
  */
  const cid = state.localCameraCid;
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
