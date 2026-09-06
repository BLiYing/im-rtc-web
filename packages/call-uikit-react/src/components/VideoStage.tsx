import type { ReactNode } from 'react';
import { useState } from 'react';

import type { PipCorner } from '../layout/pip.js';
import { defaultPipCorner, pipSizeFor } from '../layout/pip.js';
import type { RemoteParticipant } from '../state/viewTypes.js';
import { useCall } from '../useCall.js';
import { useElementSize } from '../useElementSize.js';
import { callMetrics } from '../theme.js';
import { PipView } from './PipView.js';
import { VideoTile } from './VideoTile.js';

/**
 * VideoStage 是 1v1 视频通话中的画面区（交互稿 §04）：一块全屏（A）+ 一块小窗（B）。
 *
 * 默认 A = 远端、B = 本端；`isSwapped` 时反过来。**互换是纯本端行为**，不发帧、不通知对端，
 * 但**层上界要跟着换**：谁进小窗谁报 `l`，谁上全屏谁报 `h`。
 * 小窗停在哪个角只记在这一通里（组件状态），通话结束就忘。
 */
export interface VideoStageProps {
  readonly peer: RemoteParticipant;
  /** 控制条此刻是否显示——显示时停在下面的小窗要上移 88。 */
  readonly controlsVisible: boolean;
  /** 单击画面空白处。 */
  readonly onStageTap: () => void;
}

export function VideoStage({ peer, controlsVisible, onStageTap }: VideoStageProps): ReactNode {
  const { state, actions } = useCall();
  const stage = useElementSize<HTMLDivElement>();
  const [corner, setCorner] = useState<PipCorner>(defaultPipCorner);
  const bounds = { width: stage.width, height: stage.height };
  const size = pipSizeFor(stage.width, stage.height);
  const selfCid = state.localCameraCid;
  const selfHasVideo = state.self.cameraOn && selfCid !== '';

  const remoteTile = (full: boolean) => ({
    uid: peer.uid,
    label: peer.uid,
    hasVideo: peer.hasVideo,
    hasAudio: peer.hasAudio,
    isSpeaking: peer.isSpeaking,
    networkLevel: peer.networkLevel,
    layer: full ? ('h' as const) : ('l' as const),
    avatarSize: full ? callMetrics.avatarLarge : 44,
  });
  const selfTile = (full: boolean) => ({
    uid: '',
    label: '我',
    hasVideo: selfHasVideo,
    hasAudio: state.self.micOn,
    avatarSize: full ? callMetrics.avatarLarge : 44,
    ...(selfCid === '' ? {} : { localCid: selfCid }),
  });

  return (
    <div
      ref={stage.ref}
      style={{ flex: 1, position: 'relative', minHeight: 0 }}
      data-testid="video-stage"
      data-swapped={state.isSwapped}
      onClick={onStageTap}
    >
      <VideoTile
        {...(state.isSwapped ? selfTile(true) : remoteTile(true))}
        style={{ position: 'absolute', inset: 0, borderRadius: 0, outline: 'none' }}
      />
      <PipView
        tile={state.isSwapped ? remoteTile(false) : selfTile(false)}
        size={size}
        bounds={bounds}
        corner={corner}
        onCorner={setCorner}
        lift={controlsVisible ? callMetrics.pipLift : 0}
        onTap={() => actions.setSwapped(!state.isSwapped)}
        ariaLabel={state.isSwapped ? '对方画面，按钮。轻点两下互换，轻点两下并按住可移动' : '本端画面，按钮。轻点两下互换，轻点两下并按住可移动'}
      />
    </div>
  );
}
