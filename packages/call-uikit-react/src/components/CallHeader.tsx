import type { ReactNode } from 'react';

import { buildInviteContext } from '../invite/inviteContext.js';
import { canShowInvite } from '../state/callView.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';
import { Icon, NetworkBars } from './Icon.js';
import { t } from '../i18n/index.js';

/**
 * CallHeader 是通话页顶部那条（规范 §04）：左 32 圆「小窗」、中间标题 + 副标题、右 32 圆「加人」。
 * 固定高 64，中间区域靠 flex 吃掉剩余空间——不靠优先级博弈。
 *
 * 左上角那颗就是**收进小窗的唯一入口**（控制条里不再重复放一颗）：那个位置在三端都是
 * 「离开这一屏」的手势位，用户第一反应就是往那儿点。
 */
export interface CallHeaderProps {
  readonly title: string;
  readonly subtitle: string;
  /** 1v1 对端的网络质量，画在副标题旁边；0 不画。 */
  readonly networkLevel: number;
  readonly onInvite: () => void;
  /** 给不给「收进小窗」。**来电页不给**：小窗上没有接听键，收进去就接不了（与 iOS 一致）。 */
  readonly showsMinimize?: boolean;
  /**
   * 打开成员列表（MEETING_ROOM_DESIGN §4.6 的「👥 N」）。**只有会议房给**。
   *
   * 它与「添加成员」共用右上角那一个位置：会议房没有加人这回事
   * （`canShowInvite` 明确排除了 `isMeeting`），两颗按钮不会同时出现。
   */
  readonly onMembers?: () => void;
  /**
   * 点标题复制房号。**只有会议房给**——1v1 与群通话的标题是人名，复制它没有意义。
   *
   * 会议标题写的就是房号（人数在右上角那颗「👥 N」上，不在标题里重复一遍），
   * 而房号是这一屏里要念给别人听的那个东西，光显示不够。
   */
  readonly onTitleClick?: () => void;
}

export function CallHeader({
  title, subtitle, networkLevel, onInvite, showsMinimize = true, onMembers, onTitleClick,
}: CallHeaderProps): ReactNode {
  const { state, actions, engine, invite } = useCall();
  /*
    **按钮显隐规则不以 chatGroupId 非空为条件**（HOST_INTEGRATION_DESIGN §3.4）：临时拉的
    多人通话没有群号，一样要能加人，取名单由 provider 返回通讯录。`canShowInvite` 管的是
    「是不是群通话、接没接通、房间满没满」（协议层面的硬约束）；`invite.canInvite` 是宿主
    自己的权限规则（例：群禁言时仅管理员可加人），两条都过才给按钮。
  */
  const showInvite = canShowInvite(state)
    && (invite.canInvite === undefined || invite.canInvite(buildInviteContext(engine, state)));
  return (
    <div style={styles.header}>
      {showsMinimize ? (
        <button type="button" style={styles.headerButton} aria-label={t('header.minimize')} data-testid="minimize"
          onClick={() => actions.setMinimized(true)}>
          <Icon name="pip" size={18} />
        </button>
      ) : <span />}
      <div style={styles.headerCenter}>
        {onTitleClick !== undefined ? (
          <button type="button" style={styles.titleButton} data-testid="title-copy"
            aria-label={t('header.copyRoom', { title })} onClick={onTitleClick}>
            {title}
          </button>
        ) : <div style={styles.title}>{title}</div>}
        <div style={styles.subtitle}>
          <span>{subtitle}</span>
          {networkLevel > 0 && <NetworkBars level={networkLevel} size={13} />}
        </div>
      </div>
      {showInvite ? (
        <button type="button" style={styles.headerButton} aria-label={t('header.invite')} data-testid="invite-button" onClick={onInvite}>
          <Icon name="person-add" size={18} />
        </button>
      ) : onMembers !== undefined ? (
        <button type="button" style={styles.headerButton} aria-label={t('header.members')} data-testid="members-button" onClick={onMembers}>
          <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
            👥{state.participants.length + 1}
          </span>
        </button>
      ) : <span />}
    </div>
  );
}
