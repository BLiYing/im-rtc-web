import type { ReactNode } from 'react';

import {
  cellSide,
  fixedGridDimensions,
  gridDimensions,
  hiddenCountText,
  tileLayer,
  visibleTiles,
} from '../layout/grid.js';
import type { RemoteParticipant } from '../state/viewTypes.js';
import { useCall } from '../useCall.js';
import { useElementSize } from '../useElementSize.js';
import { styles } from '../styles.js';
import { callMetrics } from '../theme.js';
import { OffscreenMembers } from './OffscreenMembers.js';
import { VideoTile } from './VideoTile.js';

/**
 * GridStage 是群通话的九宫格（交互稿 §05）。本端也占一格；邀请中的人立刻占一个占位格。
 *
 * **网格里没有加号格**（v3.3 撤掉）。加人入口只有标题栏右上角那一颗
 * （`canShowInvite` 同一条判据）：网格里再放一个是同一个动作的第二个入口，
 * 而它还会占掉一个格位——三个人的通话看起来像四个人，行列也跟着多排一格。
 *
 * # 它只回答「给定这一页，格子怎么排」
 *
 * 会议的分页是**外层容器**的事（`MeetingStage`）：那边算好这一页有谁、页码怎么显示，
 * 再把这几个人交给这里画（MEETING_ROOM_DESIGN §3 的门控表）。
 * 所有 props 省略时行为与群通话完全一致，所以那条路径一行都没有变。
 */
export interface GridStageProps {
  /** 这一页要画的远端。**省略 = 状态里的全部**（群通话，自己截断到 8 个）。 */
  readonly participants?: readonly RemoteParticipant[];
  /**
   * 恒按这么多格算行列。
   *
   * 会议分页固定 3×3：**最后一页不满时格子和满页一样大**，不放大（§4.1）——
   * 放大的话层会从 l 跳到 m、还要多等一次关键帧，翻页时整屏重排。
   */
  readonly fixedTileCount?: number;
  /** 没画格子、只报 `none` 的人。省略 = 自己从状态里算（群通话截断掉的那些）。 */
  readonly offscreen?: readonly RemoteParticipant[];
  /** 双击一格。会议里 = 钉住进演讲者视图（§4.4）。 */
  readonly onTileActivate?: (uid: string) => void;
  /** 舞台右下角那枚胶囊。省略 = 「还有 N 人未显示」（M1 止血）。 */
  readonly badge?: ReactNode;
}

export function GridStage(props: GridStageProps = {}): ReactNode {
  const { state } = useCall();
  const stage = useElementSize<HTMLDivElement>();
  const tiles = props.participants ?? visibleTiles(state.participants);
  // 本端一格 + 远端。
  const tileCount = props.fixedTileCount ?? tiles.length + 1;
  /*
    行列**跟着容器形状走**，不是只看人数：竖屏（手机、窄窗口）上两个人要上下摞，
    横屏上才是左右排。量不到尺寸时（jsdom、首帧）按正方形容器算，
    退化成老的 `ceil(sqrt(n))`——不至于渲染不出来。
  */
  const aspect = stage.height > 0 ? stage.width / stage.height : 1;
  // 分页时**不跟着容器形状变**：格子位置固定，左滑才只是换人而不是整屏重排（§4.1）。
  const { cols, rows } =
    props.fixedTileCount === undefined
      ? gridDimensions(tileCount, aspect)
      : fixedGridDimensions(tileCount);
  const side = tileCount > 1 ? cellSide({ cols, rows }, stage.width, stage.height, callMetrics.tileGap) : 0;
  const layer = tileLayer(tileCount);

  // 超出一屏的人只是没有格子，不是不在通话里——见 `OffscreenMembers`。
  const offscreen = props.offscreen ?? state.participants.slice(tiles.length);
  const badge = props.badge ?? defaultBadge(offscreen.length);

  return (
    <div style={styles.stage} data-testid="grid-stage">
      <OffscreenMembers members={offscreen} />
      <div
        ref={stage.ref}
        style={{
          ...styles.grid,
          // **格子恒为正方形**：让它吃满整块区域的话，竖屏两个人就是两条又高又窄的长条。
          gridTemplateColumns: side > 0 ? `repeat(${cols}, ${side}px)` : `repeat(${cols}, 1fr)`,
          gridTemplateRows: side > 0 ? `repeat(${rows}, ${side}px)` : `repeat(${rows}, 1fr)`,
        }}
      >
        {/* 本端那格**只表达麦克风开 / 关两态**（2026-09-09 拍板）：自己在不在说话自己知道。 */}
        <VideoTile
          uid=""
          label="我"
          hasVideo={state.self.cameraOn && state.localCameraCid !== ''}
          // 本端的静音角标读的是**本端开关**，不是回调——自己的 mute 不会绕一圈发回来。
          hasAudio={state.self.micOn}
          showsSpeaking={false}
          {...(state.localCameraCid === '' ? {} : { localCid: state.localCameraCid })}
        />
        {tiles.map((p) => (
          <VideoTile
            key={p.uid}
            uid={p.uid}
            label={p.uid}
            hasVideo={p.hasVideo}
            isVideoPending={p.isVideoPending}
            hasAudio={p.hasAudio}
            isSpeaking={p.isSpeaking}
            volume={p.volume}
            isRinging={!p.hasAccepted}
            settled={p.settled}
            networkLevel={p.networkLevel}
            layer={layer}
            {...(props.onTileActivate === undefined
              ? {}
              : { onActivate: props.onTileActivate })}
          />
        ))}
      </div>
      {badge}
    </div>
  );
}

/** defaultBadge 是群通话那枚「还有 N 人未显示」胶囊；没人被截掉时不画。 */
function defaultBadge(hidden: number): ReactNode {
  if (hidden <= 0) return null;
  return (
    <div style={styles.hiddenPill} data-testid="hidden-count">
      {hiddenCountText(hidden)}
    </div>
  );
}
