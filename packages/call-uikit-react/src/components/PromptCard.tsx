import type { ReactNode } from 'react';

import { styles } from '../styles.js';

/**
 * PromptCard 是我们自己画的提示卡（规范 §06「系统弹窗前置说明」）：
 * 权限申请前的说明、被拒后的降级提示都用它。宽 270、圆角 16、标题 T3、正文 B1、两个横排动作。
 *
 * **不是系统框**——系统框我们控制不了，这张卡是为它做铺垫或收尾的。
 */
export interface PromptCardProps {
  readonly title: string;
  readonly body: string;
  /** 次要动作（左）。不给就只有一个按钮。 */
  readonly secondary?: { readonly label: string; readonly onClick: () => void };
  /** 主动作（右，加粗）。 */
  readonly primary: { readonly label: string; readonly onClick: () => void };
  readonly testId?: string;
}

export function PromptCard({ title, body, secondary, primary, testId }: PromptCardProps): ReactNode {
  return (
    <div style={styles.dimmer} role="presentation">
      <div style={styles.card} role="alertdialog" aria-labelledby="imrtc-card-title"
        {...(testId === undefined ? {} : { 'data-testid': testId })}>
        <div style={styles.cardBody}>
          <h4 id="imrtc-card-title" style={styles.cardTitle}>{title}</h4>
          <p style={styles.cardText}>{body}</p>
        </div>
        <div style={styles.cardActions}>
          {secondary !== undefined && (
            <button type="button" style={styles.cardAction} onClick={secondary.onClick}
              data-testid={testId === undefined ? undefined : `${testId}-secondary`}>
              {secondary.label}
            </button>
          )}
          <button type="button" style={{ ...styles.cardAction, ...styles.cardActionStrong }} onClick={primary.onClick}
            data-testid={testId === undefined ? undefined : `${testId}-primary`}>
            {primary.label}
          </button>
        </div>
      </div>
    </div>
  );
}
