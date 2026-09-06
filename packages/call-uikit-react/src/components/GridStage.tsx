import type { ReactNode } from 'react';

import { cellSide, gridDimensions, tileLayer, visibleTiles } from '../layout/grid.js';
import { canShowInvite } from '../state/callView.js';
import { useCall } from '../useCall.js';
import { useElementSize } from '../useElementSize.js';
import { styles } from '../styles.js';
import { callMetrics } from '../theme.js';
import { Icon } from './Icon.js';
import { VideoTile } from './VideoTile.js';

/**
 * GridStage 是群通话的九宫格（交互稿 §05）。本端也占一格；邀请中的人立刻占一个占位格；
 * 主叫且没满员时，末位多一个**虚线加号格**——加人入口放在网格里而不是控制条上：
 * 它天然占着「下一个人的位置」，语义直给。
 */
export interface GridStageProps {
  readonly onInvite: () => void;
}

export function GridStage({ onInvite }: GridStageProps): ReactNode {
  const { state } = useCall();
  const stage = useElementSize<HTMLDivElement>();
  const tiles = visibleTiles(state.participants);
  const showAdd = canShowInvite(state);
  // 本端一格 + 远端 + （有的话）加号格。
  const tileCount = tiles.length + 1 + (showAdd ? 1 : 0);
  /*
    行列**跟着容器形状走**，不是只看人数：竖屏（手机、窄窗口）上两个人要上下摞，
    横屏上才是左右排。量不到尺寸时（jsdom、首帧）按正方形容器算，
    退化成老的 `ceil(sqrt(n))`——不至于渲染不出来。
  */
  const aspect = stage.height > 0 ? stage.width / stage.height : 1;
  const { cols, rows } = gridDimensions(tileCount, aspect);
  const side = tileCount > 1 ? cellSide({ cols, rows }, stage.width, stage.height, callMetrics.tileGap) : 0;
  // 层上界按**真人的格子数**算，加号格不算——它不收流。
  const layer = tileLayer(tiles.length + 1);

  return (
    <div style={styles.stage} ref={stage.ref} data-testid="grid-stage">
      <div
        style={{
          ...styles.grid,
          // **格子恒为正方形**：让它吃满整块区域的话，竖屏两个人就是两条又高又窄的长条。
          gridTemplateColumns: side > 0 ? `repeat(${cols}, ${side}px)` : `repeat(${cols}, 1fr)`,
          gridTemplateRows: side > 0 ? `repeat(${rows}, ${side}px)` : `repeat(${rows}, 1fr)`,
        }}
      >
        <VideoTile
          uid=""
          label="我"
          hasVideo={state.self.cameraOn && state.localCameraCid !== ''}
          // 本端的静音角标读的是**本端开关**，不是回调——自己的 mute 不会绕一圈发回来。
          hasAudio={state.self.micOn}
          {...(state.localCameraCid === '' ? {} : { localCid: state.localCameraCid })}
        />
        {tiles.map((p) => (
          <VideoTile
            key={p.uid}
            uid={p.uid}
            label={p.uid}
            hasVideo={p.hasVideo}
            hasAudio={p.hasAudio}
            isSpeaking={p.isSpeaking}
            isRinging={!p.hasAccepted}
            settled={p.settled}
            networkLevel={p.networkLevel}
            layer={layer}
          />
        ))}
        {showAdd && (
          <button type="button" style={styles.tileAdd} onClick={onInvite} aria-label="添加成员" data-testid="invite-tile">
            <Icon name="plus" size={26} />
          </button>
        )}
      </div>
    </div>
  );
}
