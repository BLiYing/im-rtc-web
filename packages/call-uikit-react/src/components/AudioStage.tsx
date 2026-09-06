import type { ReactNode } from 'react';

import { avatarGradient, avatarInitial } from '../format/avatar.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';
import { callColors } from '../theme.js';
import { NetworkBars, networkText } from './Icon.js';
import { RemoteAudioSink } from './RemoteAudioSink.js';

/**
 * AudioStage 是语音通话页与拨出中页的中间区块（规范 §03 · §04 红线）：
 * 96 头像 + 22 名字 + 13 状态 + 网络胶囊。拨出中头像外面多一圈**呼吸光环**（1.6s 循环，接通立刻停）。
 *
 * 呼吸动画要 keyframes，内联样式写不出来，所以注入一小段 `<style>`——
 * 类名带 `imrtc-` 前缀，不会撞宿主。
 */
export interface AudioStageProps {
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
  name, status, isRinging, networkLevel, showsCaption = true, children,
}: AudioStageProps): ReactNode {
  const { state } = useCall();
  const uid = state.peerUid || name;
  return (
    <div style={styles.who} data-testid="audio-stage">
      <style>{BREATHE_CSS}</style>
      {/* 语音页上没有对端的格子，声音要靠这个隐藏元素播出来。 */}
      {state.participants.map((p) => <RemoteAudioSink key={p.uid} uid={p.uid} />)}
      <div style={{ ...styles.whoAvatar, background: avatarGradient(uid) }}>
        {isRinging && <span className="imrtc-breathe" aria-hidden="true" />}
        {avatarInitial(name)}
      </div>
      {showsCaption && <div style={styles.whoName}>{name}</div>}
      {showsCaption && <div style={styles.whoStatus}>{status}</div>}
      {networkLevel > 0 && (
        <span style={{ ...styles.netChip, ...(networkLevel >= 5 ? { color: callColors.warning } : {}) }} data-testid="net-chip">
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
