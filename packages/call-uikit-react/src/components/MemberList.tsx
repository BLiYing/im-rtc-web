import type { ReactNode } from 'react';

import { avatarGradient, avatarInitial } from '../format/avatar.js';
import { useDisplayName } from '../profile.js';
import type { RemoteParticipant } from '../state/viewTypes.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';
import { Icon } from './Icon.js';
import { t } from '../i18n/index.js';

/**
 * MemberList 是**只读**的成员列表（MEETING_ROOM_DESIGN §4.6）。
 *
 * # M2 只做只读的这一半
 *
 * 搜索框与「正在说话」排序移出了 M2（§2.3）：25 人时列表一屏多一点就够翻，
 * 而成员列表在 M5（主持人操作）还要重做一次——那时才会长出「⋯」菜单里的
 * 静音 / 移出 / 设为主持人。现在放一个搜索框进去，等于为一个马上要重做的界面
 * 先付一次三端的工。
 *
 * 排序：**自己 → 进房顺序**。进房顺序就是 `state.participants` 的顺序
 * （`onUserEnter` 依次追加），不走画廊第一页那套发言人优先——
 * 列表里的人跟着说话跳位置，比画廊里更难找人。
 */
export function MemberList({
  members,
  onClose,
}: {
  readonly members: readonly RemoteParticipant[];
  readonly onClose: () => void;
}): ReactNode {
  const { state } = useCall();

  return (
    <div style={styles.sheet} role="dialog" aria-label={t('header.members')} data-testid="member-list">
      <div style={styles.sheetHeader}>
        <strong style={{ flex: 1 }}>{t('members.title', { n: members.length + 1 })}</strong>
        <button type="button" style={styles.smallButton} onClick={onClose} data-testid="member-list-close">
          {t('invite.close')}
        </button>
      </div>
      <div style={styles.sheetList}>
        {/* 自己恒在第一行，与画廊「自己占第一格」同一条规则。 */}
        <MemberRow uid="" label={t('self')} hasAudio={state.self.micOn} hasVideo={state.self.cameraOn} />
        {members.map((p) => (
          <MemberRow key={p.uid} uid={p.uid} label={p.uid} hasAudio={p.hasAudio} hasVideo={p.hasVideo} />
        ))}
      </div>
    </div>
  );
}

/** MemberRow 是一行：头像 + 名字 + 麦克风 / 摄像头状态。 */
function MemberRow({
  uid,
  label,
  hasAudio,
  hasVideo,
}: {
  readonly uid: string;
  readonly label: string;
  readonly hasAudio: boolean;
  readonly hasVideo: boolean;
}): ReactNode {
  const displayName = useDisplayName(uid, label);
  const testId = uid === '' ? 'member-self' : `member-${uid}`;
  return (
    <div style={{ ...styles.sheetRow, cursor: 'default' }} data-testid={testId}>
      <span
        style={{
          width: 28, height: 28, borderRadius: '50%', flex: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, background: avatarGradient(uid || label),
        }}
        aria-hidden="true"
      >
        {avatarInitial(displayName)}
      </span>
      <span>{displayName}</span>
      <span style={styles.memberStatus}>
        {/* 关着的那个变暗而不是消失：位置固定，一眼扫得出来谁关了什么。 */}
        <span
          style={hasAudio ? {} : styles.memberStatusOff}
          aria-label={t(hasAudio ? 'members.micOn' : 'members.micOff')}
          data-testid={`${testId}-mic`}
          data-on={hasAudio ? 'true' : 'false'}
        >
          <Icon name={hasAudio ? 'mic' : 'mic-slash'} size={16} />
        </span>
        <span
          style={hasVideo ? {} : styles.memberStatusOff}
          aria-label={t(hasVideo ? 'members.camOn' : 'members.camOff')}
          data-testid={`${testId}-cam`}
          data-on={hasVideo ? 'true' : 'false'}
        >
          <Icon name={hasVideo ? 'video' : 'video-slash'} size={16} />
        </span>
      </span>
    </div>
  );
}
