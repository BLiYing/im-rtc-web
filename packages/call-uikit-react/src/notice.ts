/**
 * 一句轻提示：固定在视口底部、2.2 秒后移除，不拦截点击。
 *
 * **为什么不用 `hint` 动作**：hint 画在通话界面里，通话收成小窗、人在宿主页面上时根本看不见
 * （「你正在通话中」正是这种场景）。直接挂在 `document.body` 上，不依赖宿主的任何组件。
 */
export function showNotice(text: string): void {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('data-im-notice', '');
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: '96px',
    transform: 'translateX(-50%)',
    maxWidth: 'calc(100vw - 64px)',
    padding: '10px 16px',
    borderRadius: '10px',
    background: 'rgba(0,0,0,0.8)',
    color: '#fff',
    font: '15px/1.4 system-ui, sans-serif',
    textAlign: 'center',
    zIndex: '2147483647',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}
