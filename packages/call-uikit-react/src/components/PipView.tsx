import type { ReactNode } from 'react';

import type { PipCorner, PipSize } from '../layout/pip.js';
import { allCorners, cornerOrigin } from '../layout/pip.js';
import { styles } from '../styles.js';
import { callMotion } from '../theme.js';
import { usePipDrag } from '../usePipDrag.js';
import type { VideoTileProps } from './VideoTile.js';
import { VideoTile } from './VideoTile.js';

/**
 * PipView 是 1v1 视频里浮在角上的那块小画面（交互稿 §04）。
 *
 * 它只管三件事：摆在哪个角、拖动时跟手、单击回调（互换由调用方做——
 * 这个组件不知道自己装的是本端还是对端）。里面装什么由 `tile` 决定。
 */
export interface PipViewProps {
  readonly tile: VideoTileProps;
  readonly size: PipSize;
  readonly bounds: { readonly width: number; readonly height: number };
  readonly corner: PipCorner;
  readonly onCorner: (corner: PipCorner) => void;
  /** 控制条显示时下面两个角要上移的量。 */
  readonly lift: number;
  readonly onTap: () => void;
  readonly ariaLabel: string;
}

export function PipView(props: PipViewProps): ReactNode {
  const { tile, size, bounds, corner, onCorner, lift, onTap, ariaLabel } = props;
  const drag = usePipDrag({ size, bounds, corner, onCorner, lift, onTap });
  /*
    容器还没量出来（首帧、jsdom 里没有 ResizeObserver）时**先藏起来**：
    0×0 的容器上四个角都会被夹到 (12,12)，画出来就是「先出现在左上角、250ms 后
    滑到右上角」。用 visibility 而不是不渲染——测试要找得到它，画面上又不该看见。
  */
  const measured = bounds.width > 0 && bounds.height > 0;

  return (
    <>
      {drag.isDragging && allCorners.map((c) => {
        const ghost = cornerOrigin(c, size, bounds.width, bounds.height, lift);
        return (
          <div key={c} style={{ ...styles.pipCornerGhost, left: ghost.x, top: ghost.y, width: size.width, height: size.height }} />
        );
      })}
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        data-testid="pip"
        data-corner={corner}
        style={{
          ...styles.pip,
          ...(drag.isDragging ? styles.pipDragging : {}),
          left: drag.origin.x,
          top: drag.origin.y,
          width: size.width,
          height: size.height,
          visibility: measured ? 'visible' : 'hidden',
          // 拖动中不做过渡（要跟手）；松手吸角与控制条避让走 250ms spring 近似。
          // 还没量出容器时也不做过渡——第一次落位不该有动画。
          transition: drag.isDragging || !measured
            ? 'none'
            : `left ${callMotion.snapMs}ms cubic-bezier(.2,.9,.3,1.1), top ${callMotion.snapMs}ms cubic-bezier(.2,.9,.3,1.1)`,
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onTap();
        }}
        {...drag.handlers}
      >
        <VideoTile {...tile} style={{ width: '100%', height: '100%', borderRadius: 0, outline: 'none', pointerEvents: 'none' }} />
      </div>
    </>
  );
}
