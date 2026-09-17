import { useEffect } from 'react';
import type { ReactNode } from 'react';

import type { RemoteParticipant } from '../state/viewTypes.js';
import { useCall } from '../useCall.js';

/**
 * OffscreenMembers：此刻**没有格子**的人——只报 `none`，什么都不画
 * （MEETING_ROOM_DESIGN §4.3）。
 *
 * 看不见的人原先照常按默认层收视频，白白吃下行。`none` 在通话房里 = 暂停下发、保留订阅；
 * 在会议房里引擎还会把它翻译成「五秒后退订」（engine 的 `roomPaging.ts`），
 * 翻回来只换层、不重协商。
 *
 * **声音不受影响**：远端音频从 2.0.0 起由引擎自己播（`RemoteAudioPlayer`），
 * 与画面挂在哪无关。原先那个每人一个隐藏 `<audio>` 的 `RemoteAudioSink` 因此退役。
 *
 * 画廊与演讲者视图**共用这一个**：两边都会把一部分人留在屏幕外，
 * 各写一份的话总有一边会漏——漏掉的表现是「翻走的人还在按 m 层给你推流」，
 * 界面上完全看不出来。
 */
export function OffscreenMembers({
  members,
}: {
  readonly members: readonly RemoteParticipant[];
}): ReactNode {
  return (
    <>
      {members.map((p) => (
        <OffscreenMember key={p.uid} uid={p.uid} hasVideo={p.hasVideo} />
      ))}
    </>
  );
}

/**
 * 单个人的那一条。
 *
 * `hasVideo` 进依赖的理由同 `VideoTile`：人先进来、轨道后到，轨道到了那一刻要再报一次。
 * 他回到屏幕上时 `VideoTile` 挂载会按格子大小重报层，不用这里撤。
 */
function OffscreenMember({
  uid,
  hasVideo,
}: {
  readonly uid: string;
  readonly hasVideo: boolean;
}): ReactNode {
  const { engine } = useCall();
  useEffect(() => {
    void engine.setRemoteLayer(uid, 'none');
  }, [engine, uid, hasVideo]);
  return null;
}
