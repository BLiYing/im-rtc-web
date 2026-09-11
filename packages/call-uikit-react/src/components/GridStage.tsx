import type { ReactNode } from 'react';

import { cellSide, gridDimensions, tileLayer, visibleTiles } from '../layout/grid.js';
import { useCall } from '../useCall.js';
import { useElementSize } from '../useElementSize.js';
import { styles } from '../styles.js';
import { callMetrics } from '../theme.js';
import { RemoteAudioSink } from './RemoteAudioSink.js';
import { VideoTile } from './VideoTile.js';

/**
 * GridStage 是群通话的九宫格（交互稿 §05）。本端也占一格；邀请中的人立刻占一个占位格。
 *
 * **网格里没有加号格**（v3.3 撤掉）。加人入口只有标题栏右上角那一颗
 * （`canShowInvite` 同一条判据）：网格里再放一个是同一个动作的第二个入口，
 * 而它还会占掉一个格位——三个人的通话看起来像四个人，行列也跟着多排一格。
 */
export function GridStage(): ReactNode {
  const { state } = useCall();
  const stage = useElementSize<HTMLDivElement>();
  const tiles = visibleTiles(state.participants);
  // 本端一格 + 远端。
  const tileCount = tiles.length + 1;
  /*
    行列**跟着容器形状走**，不是只看人数：竖屏（手机、窄窗口）上两个人要上下摞，
    横屏上才是左右排。量不到尺寸时（jsdom、首帧）按正方形容器算，
    退化成老的 `ceil(sqrt(n))`——不至于渲染不出来。
  */
  const aspect = stage.height > 0 ? stage.width / stage.height : 1;
  const { cols, rows } = gridDimensions(tileCount, aspect);
  const side = tileCount > 1 ? cellSide({ cols, rows }, stage.width, stage.height, callMetrics.tileGap) : 0;
  const layer = tileLayer(tileCount);

  /*
    **超出一屏的人只是没有格子，不是不在通话里——声音必须接上。**

    浏览器只播挂在媒体元素上的流（`engine.attachView(uid, el)`），没有元素的人
    就是**彻底静音**。原先九宫格只为前 8 位远端渲染 VideoTile，会议房（服务端不设
    人数上限）进到第 10 个人时，第 9、10 位在场却完全听不见，界面上还没有任何提示。
    小窗（MiniWindow）与语音页（AudioStage）本来就为没画格子的人补了 sink，
    只有这里漏了。iOS / Android 没有这个坑——那两端的远端音频由音频设备直接播，不绑视图。
  */
  const offscreen = state.participants.slice(tiles.length);

  return (
    <div style={styles.stage} ref={stage.ref} data-testid="grid-stage">
      {offscreen.map((p) => (
        <RemoteAudioSink key={p.uid} uid={p.uid} />
      ))}
      <div
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
          />
        ))}
      </div>
    </div>
  );
}
