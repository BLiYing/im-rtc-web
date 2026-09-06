import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';

import type { IconName } from './Icon.js';
import { Icon } from './Icon.js';
import { styles } from '../styles.js';
import { callColors, callMetrics, callMotion } from '../theme.js';

/**
 * 通话页的圆形控制按钮：**圆里一个图标、圆下一行文字**（规范 §06「控制按钮的五个态」）。
 *
 * 与 iOS 的 `IMControlButton` 是同一套视觉（56 圆、开启态白底黑字、挂断恒红、接听恒绿），
 * 文案也逐字对齐——同一个产品在两端不该长得不一样。
 *
 * 五个态：常态（白 14%）、开启（反白 + 换成 slash 图标）、危险（恒红、64 大）、
 * 接听（恒绿、64 大）、禁用（35% 不透明，**点了要出提示不能静默**——由调用方决定提示什么）。
 * 按下缩放 0.92 + 底色加深 120ms；hover 底色 14% → 22%（桌面才有，手机没有 hover）。
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
  /** 角色决定常态配色：挂断恒红、接听恒绿。危险 / 接听默认 64 大。 */
  readonly role?: 'normal' | 'danger' | 'accept';
  /** 尺寸：normal 56 / big 64 / small 44（第二排的次级动作）。 */
  readonly size?: 'normal' | 'big' | 'small';
  /** 禁用态：权限被拒的摄像头、满员时的加人。点击仍会回调，好让调用方出提示。 */
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly testId?: string;
}

export function ControlButton(props: ControlButtonProps): ReactNode {
  const { icon, caption, onIcon, onCaption, isOn = false, role = 'normal', disabled = false, onClick, testId } = props;
  const size = props.size ?? (role === 'normal' ? 'normal' : 'big');
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const shownIcon = isOn ? (onIcon ?? icon) : icon;
  const shownCaption = isOn ? (onCaption ?? caption) : caption;

  return (
    <button
      type="button"
      style={{ ...styles.controlButton, ...(disabled ? { opacity: 0.35, cursor: 'default' } : {}) }}
      onClick={onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => { setHover(false); setPressed(false); }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      aria-pressed={role === 'normal' ? isOn : undefined}
      aria-disabled={disabled || undefined}
      aria-label={shownCaption}
      {...(testId === undefined ? {} : { 'data-testid': testId })}
    >
      <span style={{ ...styles.controlCircle, ...circleStyle(role, isOn, size, hover && !disabled, pressed && !disabled) }}>
        <Icon name={shownIcon} size={size === 'big' ? callMetrics.iconBig : size === 'small' ? callMetrics.iconSmall : callMetrics.icon} />
      </span>
      <span style={styles.controlCaption}>{shownCaption}</span>
    </button>
  );
}

function circleStyle(
  role: 'normal' | 'danger' | 'accept',
  isOn: boolean,
  size: 'normal' | 'big' | 'small',
  hover: boolean,
  pressed: boolean,
): CSSProperties {
  const px = size === 'big' ? callMetrics.controlBig : size === 'small' ? callMetrics.controlSmall : callMetrics.control;
  const base: CSSProperties = {
    width: px, height: px,
    transform: pressed ? 'scale(0.92)' : 'none',
    transition: `transform ${pressed ? callMotion.pressMs : callMotion.releaseMs}ms ease-out, background ${callMotion.pressMs}ms`,
  };
  if (role === 'danger') return { ...base, background: pressed ? callColors.dangerPressed : callColors.danger, color: callColors.fg };
  if (role === 'accept') return { ...base, background: pressed ? callColors.acceptPressed : callColors.accept, color: callColors.acceptFg };
  if (isOn) return { ...base, background: pressed ? callColors.ctlOnPressed : callColors.ctlOn, color: callColors.ctlOnFg };
  return { ...base, background: hover || pressed ? callColors.ctlHover : callColors.ctlIdle };
}
