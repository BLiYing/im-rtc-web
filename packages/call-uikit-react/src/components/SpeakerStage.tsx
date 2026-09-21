import type { ReactNode } from 'react';

import { focusedLayer } from '../layout/grid.js';
import type { RemoteParticipant } from '../state/viewTypes.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';
import { OffscreenMembers } from './OffscreenMembers.js';
import { VideoTile } from './VideoTile.js';
import { t } from '../i18n/index.js';

/** SpeakerStageProps 是演讲者视图要的东西。 */
export interface SpeakerStageProps {
  /** 钉住的那个人。他不在房里了由调用方负责取消钉住。 */
  readonly pinned: RemoteParticipant;
  /** 底部条的候选（通常是当前排列）。这里自己取前几个。 */
  readonly others: readonly RemoteParticipant[];
  /** 取消钉住。 */
  readonly onUnpin: () => void;
}

/** STRIP_TILES 是底部条放几格：自己 + 最近 3 位（§4.4）。 */
const STRIP_TILES = 4;

/**
 * SpeakerStage 是**钉住之后**的演讲者视图（MEETING_ROOM_DESIGN §4.4）。
 *
 * # M2 只做「钉住」这一半
 *
 * 没钉住时**不会**进这一屏——「自动跟着主讲人切主画面」移出了 M2（§2.3）。
 * 理由是主画面高频切 h 层、每切一次都要等关键帧，几个人抢话时主画面每隔几秒糊一下；
 * 而钉住是用户明确指定的，切换频率由他自己决定。右上角那个「画廊 / 演讲者」切换按钮
 * 也随之不做：进出这一屏的唯一途径就是双击格子与点 📌。
 *
 * # 层
 *
 * 主画面报 `h`，底部条报 `l`。被换下主画面的人留在底部条里，所以换回来时先有 l 层画面、
 * 再升到 h，不会从黑屏开始。
 */
export function SpeakerStage({ pinned, others, onUnpin }: SpeakerStageProps): ReactNode {
  const { state } = useCall();
  const rest = others.filter((p) => p.uid !== pinned.uid);
  const strip = rest.slice(0, STRIP_TILES - 1);
  // 主画面 + 底部条之外的人没有格子，照样要报 none（与画廊同一条，见 OffscreenMembers）。
  const offscreen = rest.slice(STRIP_TILES - 1);

  return (
    <div style={styles.speakerStage} data-testid="speaker-stage">
      <OffscreenMembers members={offscreen} />
      <button type="button" style={styles.pinBadge} onClick={onUnpin} data-testid="unpin">
        <span aria-hidden="true">📌</span>
        取消钉住
      </button>
      <div style={styles.speakerMain}>
        <VideoTile
          uid={pinned.uid}
          label={pinned.uid}
          hasVideo={pinned.hasVideo}
          isVideoPending={pinned.isVideoPending}
          hasAudio={pinned.hasAudio}
          isSpeaking={pinned.isSpeaking}
          volume={pinned.volume}
          networkLevel={pinned.networkLevel}
          layer={focusedLayer}
          avatarSize={96}
          style={{ height: '100%' }}
          onActivate={onUnpin}
        />
      </div>
      <div style={styles.speakerStrip}>
        {/* 底部条第一格恒是自己，与画廊里「自己占第一格」同一条规则。 */}
        <VideoTile
          uid=""
          label={t('self')}
          hasVideo={state.self.cameraOn && state.localCameraCid !== ''}
          hasAudio={state.self.micOn}
          showsSpeaking={false}
          avatarSize={28}
          compact
          {...(state.localCameraCid === '' ? {} : { localCid: state.localCameraCid })}
        />
        {strip.map((p) => (
          <VideoTile
            key={p.uid}
            uid={p.uid}
            label={p.uid}
            hasVideo={p.hasVideo}
            isVideoPending={p.isVideoPending}
            hasAudio={p.hasAudio}
            isSpeaking={p.isSpeaking}
            volume={p.volume}
            networkLevel={p.networkLevel}
            layer="l"
            avatarSize={28}
            compact
          />
        ))}
      </div>
    </div>
  );
}
