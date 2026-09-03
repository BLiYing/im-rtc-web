import type { CSSProperties } from 'react';

/**
 * 内联样式常量。
 *
 * **不引 UI 组件库、不引 CSS 框架**（CONVENTIONS §11）：SDK 要轻，
 * 宿主的技术栈不该被我们绑架。用内联样式而不是 CSS 文件，
 * 也免掉宿主打包器要不要处理 `.css` 的问题。
 *
 * 想换皮肤的话覆盖这里导出的对象即可——但样式不是本产品的卖点，别在这上面加抽象。
 */

const overlayBg = 'rgba(18, 20, 24, 0.96)';
const accent = '#2f80ed';
const danger = '#e5484d';

export const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9000, background: overlayBg, color: '#fff',
    display: 'flex', flexDirection: 'column',
    font: '14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  } satisfies CSSProperties,

  header: {
    padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  } satisfies CSSProperties,

  title: { fontSize: 16, fontWeight: 600 } satisfies CSSProperties,
  subtitle: { fontSize: 13, opacity: 0.7 } satisfies CSSProperties,

  stage: { flex: 1, minHeight: 0, padding: '0 12px 12px', display: 'flex' } satisfies CSSProperties,

  grid: { flex: 1, display: 'grid', gap: 8, minHeight: 0 } satisfies CSSProperties,

  tile: {
    position: 'relative', background: '#000', borderRadius: 10, overflow: 'hidden',
    // **拆成 longhand**：与 tileSpeaking 的 borderColor 混用简写时，
    // React 在重渲染里删简写属性会留下不一致的边框（它自己会警告这件事）。
    minHeight: 0, borderWidth: 2, borderStyle: 'solid', borderColor: 'transparent',
  } satisfies CSSProperties,

  tileSpeaking: { borderColor: '#3ddc84' } satisfies CSSProperties,

  video: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } satisfies CSSProperties,

  tileLabel: {
    position: 'absolute', left: 8, bottom: 8, padding: '2px 8px', borderRadius: 6,
    background: 'rgba(0,0,0,0.55)', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center',
  } satisfies CSSProperties,

  tileBadge: {
    position: 'absolute', right: 8, top: 8, width: 24, height: 24, borderRadius: '50%',
    background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 13,
  } satisfies CSSProperties,

  avatar: {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 28, fontWeight: 600, color: '#fff', background: '#2b3038',
  } satisfies CSSProperties,

  selfPreview: {
    position: 'absolute', right: 16, top: 16, width: 120, height: 160, borderRadius: 10,
    overflow: 'hidden', background: '#000', border: '1px solid rgba(255,255,255,0.15)',
  } satisfies CSSProperties,

  controls: {
    display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center', padding: '16px 0 24px',
  } satisfies CSSProperties,

  button: {
    width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: 'rgba(255,255,255,0.14)', color: '#fff', fontSize: 12, lineHeight: 1.1,
  } satisfies CSSProperties,

  buttonOff: { background: 'rgba(255,255,255,0.35)', color: '#111' } satisfies CSSProperties,
  buttonAccept: { background: '#3ddc84', color: '#08210f' } satisfies CSSProperties,
  buttonDanger: { background: danger } satisfies CSSProperties,

  mini: {
    position: 'fixed', right: 16, bottom: 16, zIndex: 9000, width: 160,
    background: overlayBg, color: '#fff', borderRadius: 12, overflow: 'hidden',
    boxShadow: '0 6px 24px rgba(0,0,0,0.35)', cursor: 'pointer',
    font: '13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  } satisfies CSSProperties,

  miniBody: { padding: '8px 10px', display: 'flex', justifyContent: 'space-between' } satisfies CSSProperties,

  toast: {
    position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9100,
    minWidth: 300, background: overlayBg, color: '#fff', borderRadius: 12, padding: 16,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)', display: 'flex', gap: 12, alignItems: 'center',
    font: '14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  } satisfies CSSProperties,

  toastActions: { marginLeft: 'auto', display: 'flex', gap: 8 } satisfies CSSProperties,

  smallButton: {
    padding: '8px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
    background: accent, color: '#fff', fontSize: 13,
  } satisfies CSSProperties,
};
