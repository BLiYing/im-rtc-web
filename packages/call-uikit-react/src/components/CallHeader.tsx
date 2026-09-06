import type { ReactNode } from 'react';

import { canShowInvite } from '../state/callView.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';
import { Icon, NetworkBars } from './Icon.js';

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
}

export function CallHeader({ title, subtitle, networkLevel, onInvite }: CallHeaderProps): ReactNode {
  const { state, actions } = useCall();
  return (
    <div style={styles.header}>
      <button type="button" style={styles.headerButton} aria-label="收进小窗" data-testid="minimize"
        onClick={() => actions.setMinimized(true)}>
        <Icon name="pip" size={18} />
      </button>
      <div style={styles.headerCenter}>
        <div style={styles.title}>{title}</div>
        <div style={styles.subtitle}>
          <span>{subtitle}</span>
          {networkLevel > 0 && <NetworkBars level={networkLevel} size={13} />}
        </div>
      </div>
      {canShowInvite(state) ? (
        <button type="button" style={styles.headerButton} aria-label="添加成员" data-testid="invite-button" onClick={onInvite}>
          <Icon name="person-add" size={18} />
        </button>
      ) : <span />}
    </div>
  );
}
