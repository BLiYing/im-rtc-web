import type { Layer } from '@im-rtc/call-engine';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import { avatarGradient, avatarInitial } from '../format/avatar.js';
import type { SettledOutcome } from '../state/viewTypes.js';
import { settledText } from '../state/participants.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';
import { Icon, NetworkBars, isNetworkPoor } from './Icon.js';

/** VideoTileProps 是一个格子。 */
export interface VideoTileProps {
  /** 远端成员的 uid；本端预览传空串并给 localCid。 */
  readonly uid: string;
  readonly label: string;
  readonly hasVideo: boolean;
  /**
   * 麦克风是否可用。`false` 时格子上挂一个静音角标。
   *
   * **默认 true**：`userAudioAvailable` 只在状态**变化**时才抛，
   * 一开始就正常的人不会有事件——默认 false 会让所有人都显示成静音。
   */
  readonly hasAudio?: boolean;
  readonly isSpeaking?: boolean;
  /** 还在响铃 / 邀请中：整格 55% 不透明 + 顶部一行「呼叫中…」（规范 §06）。 */
  readonly isRinging?: boolean;
  /** 邀请中的格子拿到的终局，显示在原来「呼叫中…」的位置。 */
  readonly settled?: SettledOutcome;
  /** 网络质量 0~6；差的时候右下角出橙色角标。 */
  readonly networkLevel?: number;
  /** 这个格子要报的层上界（协议 §3.5）。本端预览不用给。 */
  readonly layer?: Layer;
  /** 本端预览的轨道 cid。本端画面**水平镜像**，远端不镜像。 */
  readonly localCid?: string;
  /** 头像大小，默认 44。 */
  readonly avatarSize?: number;
  readonly style?: CSSProperties;
}

/**
 * VideoTile 是一个视频格子。
 *
 * **画面只经 `engine.attachView` 挂载**（CONVENTIONS §1）：uikit 不碰
 * `RTCPeerConnection`，也不自己拼 `MediaStream`。换媒体实现时这个组件一行不用改。
 */
export function VideoTile(props: VideoTileProps): ReactNode {
  const {
    uid, label, hasVideo, hasAudio = true, isSpeaking = false, isRinging = false, settled = '',
    networkLevel = 0, layer, localCid, avatarSize = 44, style,
  } = props;
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

  const tileStyle = {
    ...styles.tile,
    ...(isSpeaking ? styles.tileSpeaking : {}),
    ...(isRinging ? styles.tileRinging : {}),
    ...style,
  };
  const testUid = uid === '' ? 'self' : uid;
  const isMirrored = localCid !== undefined;
  return (
    <div style={tileStyle} data-testid={`tile-${testUid}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // 本端预览必须静音，否则自己听自己会啸叫。
        muted={isMirrored}
        style={{
          ...styles.video,
          ...(isMirrored ? styles.videoMirrored : {}),
          visibility: hasVideo ? 'visible' : 'hidden',
        }}
      />
      {!hasVideo && (
        <div style={styles.avatar}>
          <div style={{
            ...styles.avatarDisc, width: avatarSize, height: avatarSize,
            fontSize: Math.round(avatarSize / 3), background: avatarGradient(uid || label),
          }}>
            {avatarInitial(label)}
          </div>
        </div>
      )}
      {isRinging && (
        <div style={styles.tileRingingText} data-testid={`ringing-${testUid}`}>
          {settled === '' ? '呼叫中…' : settledText(settled)}
        </div>
      )}
      {/* 静音角标放右上，与左下的名字牌分开：名字可能很长，挤在一起时角标会被顶出格子。 */}
      {!hasAudio && (
        <div style={styles.tileBadge} role="img" aria-label="已静音" data-testid={`muted-${testUid}`}>
          <Icon name="mic-slash" size={14} />
        </div>
      )}
      {isNetworkPoor(networkLevel) && (
        <div style={styles.tileNetBadge} role="img" aria-label="网络不佳" data-testid={`net-${testUid}`}>
          <NetworkBars level={networkLevel} />
        </div>
      )}
      <div style={{ ...styles.tileLabel, ...(isSpeaking ? styles.tileLabelSpeaking : {}) }}>
        <span>{label}</span>
        {isSpeaking && <span role="img" aria-label="正在说话" data-testid={`speaking-${testUid}`}><Icon name="speaker" size={12} /></span>}
      </div>
    </div>
  );
}
