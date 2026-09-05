import type { CSSProperties, ReactNode } from 'react';

import type { IconName } from './Icon.js';
import { Icon } from './Icon.js';
import { styles } from '../styles.js';

/**
 * 通话页的圆形控制按钮：**圆里一个图标、圆下一行文字**。
 *
 * 与 iOS 的 `IMControlButton` 是同一套视觉（56pt 圆、开启态白底黑字、
 * 挂断恒红、接听恒绿），文案也逐字对齐——同一个产品在两端不该长得不一样。
 *
 * 原先 Web 这边是「56px 圆里塞一行汉字」：「关摄像头」四个字挤在直径 56 的圆里，
 * 既看不清也和 iOS 对不上。实测反馈：「静音按钮都没有对应的图片」。
 *
 * **开启态除了变色还要换图标**——不拿颜色作为唯一的信息载体（无障碍）。
 */
export interface ControlButtonProps {
  /** 关闭态的图标与文案。 */
  readonly icon: IconName;
  readonly caption: string;
  /** 开启态；不给就沿用关闭态那一套。 */
  readonly onIcon?: IconName;
  readonly onCaption?: string;
  readonly isOn?: boolean;
  /** 角色决定常态配色：挂断恒红、接听恒绿。 */
  readonly role?: 'normal' | 'danger' | 'accept';
  readonly onClick: () => void;
  readonly testId?: string;
}

export function ControlButton(props: ControlButtonProps): ReactNode {
  const { icon, caption, onIcon, onCaption, isOn = false, role = 'normal', onClick, testId } = props;
  const shownIcon = isOn ? (onIcon ?? icon) : icon;
  const shownCaption = isOn ? (onCaption ?? caption) : caption;

  return (
    <button
      type="button"
      style={styles.controlButton}
      onClick={onClick}
      aria-pressed={role === 'normal' ? isOn : undefined}
      aria-label={shownCaption}
      {...(testId === undefined ? {} : { 'data-testid': testId })}
    >
      <span style={{ ...styles.controlCircle, ...circleStyle(role, isOn) }}>
        <Icon name={shownIcon} />
      </span>
      <span style={styles.controlCaption}>{shownCaption}</span>
    </button>
  );
}

function circleStyle(role: 'normal' | 'danger' | 'accept', isOn: boolean): CSSProperties {
  if (role === 'danger') return styles.controlDanger;
  if (role === 'accept') return styles.controlAccept;
  return isOn ? styles.controlOn : {};
}
