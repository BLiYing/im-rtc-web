import type { Layer } from '@im-rtc/call-engine';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import { useCall } from '../useCall.js';
import { styles } from '../styles.js';

/** VideoTileProps 是一个格子。 */
export interface VideoTileProps {
  /** 远端成员的 uid；本端预览传空串并给 localCid。 */
  readonly uid: string;
  readonly label: string;
  readonly hasVideo: boolean;
  readonly isSpeaking?: boolean;
  /** 这个格子要报的层上界（协议 §3.5）。本端预览不用给。 */
  readonly layer?: Layer;
  /** 本端预览的轨道 cid。 */
  readonly localCid?: string;
  readonly style?: React.CSSProperties;
}

/**
 * VideoTile 是一个视频格子。
 *
 * **画面只经 `engine.attachView` 挂载**（CONVENTIONS §1）：uikit 不碰
 * `RTCPeerConnection`，也不自己拼 `MediaStream`。换媒体实现时这个组件一行不用改。
 */
export function VideoTile(props: VideoTileProps): ReactNode {
  const { uid, label, hasVideo, isSpeaking = false, layer, localCid, style } = props;
  const { engine } = useCall();
  const videoRef = useRef<HTMLVideoElement>(null);

  // 挂载与卸载成对：卸载时必须把 srcObject 清掉，否则解码器还占着（CONVENTIONS §5）。
  useEffect(() => {
    const el = videoRef.current;
    if (el === null) return;
    if (localCid !== undefined) {
      engine.attachLocalView(localCid, el);
      return () => engine.attachLocalView(localCid, null);
    }
    engine.attachView(uid, el);
    return () => engine.attachView(uid, null);
  }, [engine, uid, localCid]);

  // 格子大小变了就重报层上界。**这是省带宽的关键一步**：
  // 九宫格里每个人都按 h 层收，一屏就是 8 路 720p。
  useEffect(() => {
    if (layer === undefined || uid === '') return;
    void engine.setRemoteLayer(uid, layer);
  }, [engine, uid, layer]);

  const tileStyle = { ...styles.tile, ...(isSpeaking ? styles.tileSpeaking : {}), ...style };
  return (
    <div style={tileStyle} data-testid={`tile-${localCid === undefined ? uid : 'self'}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // 本端预览必须静音，否则自己听自己会啸叫。
        muted={localCid !== undefined}
        style={{ ...styles.video, visibility: hasVideo ? 'visible' : 'hidden' }}
      />
      {!hasVideo && <div style={styles.avatar}>{initial(label)}</div>}
      <div style={styles.tileLabel}>
        <span>{label}</span>
        {isSpeaking && <span aria-label="正在说话">🔊</span>}
      </div>
    </div>
  );
}

function initial(label: string): string {
  return label.trim().slice(0, 1).toUpperCase() || '?';
}
