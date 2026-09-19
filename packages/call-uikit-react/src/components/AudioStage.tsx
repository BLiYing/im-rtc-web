import type { ReactNode } from 'react';

import { avatarGradient, avatarInitial } from '../format/avatar.js';
import { useDisplayName, useParticipantProfile } from '../profile.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';
import { callColors } from '../theme.js';
import { NetworkBars, isNetworkBad, networkText } from './Icon.js';

/**
 * AudioStage 是语音通话页与拨出中页的中间区块（规范 §03 · §04 红线）：
 * 96 头像 + 22 名字 + 13 状态 + 网络胶囊。拨出中头像外面多一圈**呼吸光环**（1.6s 循环，接通立刻停）。
 *
 * 呼吸动画要 keyframes，内联样式写不出来，所以注入一小段 `<style>`——
 * 类名带 `imrtc-` 前缀，不会撞宿主。
 */
export interface AudioStageProps {
  /** 宿主解析用的 uid；缺省不解析（原样显示 `name`）。 */
  readonly uid?: string;
  readonly name: string;
  readonly status: string;
  readonly isRinging: boolean;
  readonly networkLevel: number;
  /**
   * 名字与状态这一行要不要显示。
   *
   * **接通之后不显示**：那时候标题栏里已经是「对方名字 + 计时器」，中间再写一遍
   * 就是同一句话在一屏里出现两次，还各走各的计时。呼叫中 / 来电页的标题栏是空的，
   * 名字与状态只在那两屏出现。
   */
  readonly showsCaption?: boolean;
  /** 叠在上面的东西（拨出中的本端预览小窗）。 */
  readonly children?: ReactNode;
}

export function AudioStage({
  uid: whoUid = '', name, status, isRinging, networkLevel, showsCaption = true, children,
}: AudioStageProps): ReactNode {
  const { state } = useCall();
  const uid = state.peerUid || name;
  /*
    名字与头像交给宿主解析（见 profile.tsx）。**1v1 呼叫中 / 来电页的大头像也要走这里**，
    不只是九宫格的格子——否则宿主注入的名字只在格子里生效，最显眼的这一屏还是 uid。
    没有 ProfileProvider 或解析不到时，`useDisplayName` 原样返回 `name`。
  */
  const shownName = useDisplayName(whoUid, name);
  const photo = useParticipantProfile(whoUid)?.avatarUrl ?? '';
  return (
    <div style={styles.who} data-testid="audio-stage">
      <style>{BREATHE_CSS}</style>
      <div style={{ ...styles.whoAvatar, background: avatarGradient(uid) }}>
        {isRinging && <span className="imrtc-breathe" aria-hidden="true" />}
        {photo === ''
          ? avatarInitial(shownName)
          : <img src={photo} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} data-testid="audio-stage-avatar" />}
      </div>
      {showsCaption && <div style={styles.whoName}>{shownName}</div>}
      {showsCaption && <div style={styles.whoStatus}>{status}</div>}
      {networkLevel > 0 && (
        <span style={{ ...styles.netChip, ...(isNetworkBad(networkLevel) ? { color: callColors.warning } : {}) }} data-testid="net-chip">
          <NetworkBars level={networkLevel} size={12} />
          {networkText(networkLevel)}
        </span>
      )}
      {children}
    </div>
  );
}

const BREATHE_CSS = `
.imrtc-breathe{position:absolute;inset:-11px;border-radius:50%;border:3px solid rgba(255,255,255,.25);
  animation:imrtc-breathe 1.6s ease-in-out infinite;pointer-events:none}
@keyframes imrtc-breathe{0%,100%{border-color:rgba(255,255,255,.25)}50%{border-color:rgba(255,255,255,.05)}}
@media (prefers-reduced-motion:reduce){.imrtc-breathe{animation:none}}
`;
