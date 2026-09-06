import type { CSSProperties } from 'react';

import { callColors, callFont, callMetrics } from './theme.js';

/**
 * 内联样式常量。**每一个值都取自 `theme.ts` 的令牌**，这里只做排布。
 *
 * **不引 UI 组件库、不引 CSS 框架**（CONVENTIONS §11）：SDK 要轻，
 * 宿主的技术栈不该被我们绑架。用内联样式而不是 CSS 文件，
 * 也免掉宿主打包器要不要处理 `.css` 的问题。
 *
 * 想换皮肤的话改 `theme.ts`——但样式不是本产品的卖点，别在这上面加抽象。
 */
export const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9000, background: callColors.overlay, color: callColors.fg,
    display: 'flex', flexDirection: 'column', font: `14px/1.5 ${callFont}`,
  } satisfies CSSProperties,

  /** 语音通话页用径向渐变底（规范 §02 surface/call-bg）。视频页被画面盖住，用不到。 */
  overlayAudio: { background: callColors.callGradient } satisfies CSSProperties,

  /** 顶部标题区固定高度（规范 §04）：中间区域靠 flex 吃掉剩余空间，不靠优先级博弈。 */
  header: {
    height: callMetrics.headerHeight, flex: 'none', display: 'grid',
    gridTemplateColumns: '48px 1fr 48px', alignItems: 'center', padding: '8px 16px 0',
  } satisfies CSSProperties,
  headerCenter: { textAlign: 'center', minWidth: 0 } satisfies CSSProperties,
  /** 顶部 32 的圆形小按钮（收起 / 加人）。 */
  headerButton: {
    width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: callColors.ctlIdle, color: callColors.fg, display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: 0,
  } satisfies CSSProperties,

  title: { fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } satisfies CSSProperties,
  subtitle: {
    fontSize: 13, color: callColors.fgDim, fontVariantNumeric: 'tabular-nums',
    display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center',
  } satisfies CSSProperties,

  stage: { flex: 1, minHeight: 0, padding: '0 12px 12px', display: 'flex', position: 'relative' } satisfies CSSProperties,

  /** 语音页 / 拨出中的「谁」区块：96 头像 + 22 名字 + 13 状态（规范 §03）。 */
  who: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 6, textAlign: 'center',
  } satisfies CSSProperties,
  whoAvatar: {
    width: callMetrics.avatarLarge, height: callMetrics.avatarLarge, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 700,
    color: callColors.fg, boxShadow: '0 12px 34px rgba(0,0,0,0.45)', marginBottom: 8, position: 'relative',
  } satisfies CSSProperties,
  whoName: { fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' } satisfies CSSProperties,
  whoStatus: { fontSize: 13, color: callColors.fgDim, fontVariantNumeric: 'tabular-nums' } satisfies CSSProperties,
  netChip: {
    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: callColors.fgDim,
    background: callColors.ctlIdle, borderRadius: 999, padding: '2px 9px', marginTop: 4,
  } satisfies CSSProperties,

  /** 结束画面：整屏就一句话，居中。**不复用通话页的骨架**（见 CallEnded.tsx）。 */
  endedBox: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  } satisfies CSSProperties,
  endedReason: { fontSize: 17 } satisfies CSSProperties,

  // 网格整体居中：格子是正方形，宽高多半吃不满整块区域，剩下的留白要匀在两边。
  grid: {
    flex: 1, display: 'grid', gap: callMetrics.tileGap, minHeight: 0,
    justifyContent: 'center', alignContent: 'center',
  } satisfies CSSProperties,

  tile: {
    position: 'relative', background: callColors.tile, borderRadius: callMetrics.tileRadius, overflow: 'hidden',
    // 描边用 outline 内缩，不撑大格子（规范 §06）。
    minHeight: 0, outlineWidth: callMetrics.speakingOutline, outlineStyle: 'solid',
    outlineColor: 'transparent', outlineOffset: -callMetrics.speakingOutline,
  } satisfies CSSProperties,
  tileSpeaking: { outlineColor: callColors.accept } satisfies CSSProperties,
  /** 邀请中的占位格：整格 55% 不透明（规范 §06）。 */
  tileRinging: { opacity: 0.55 } satisfies CSSProperties,
  tileRingingText: {
    position: 'absolute', left: 0, right: 0, top: 10, textAlign: 'center', fontSize: 11,
    color: callColors.fg, fontVariantNumeric: 'tabular-nums',
  } satisfies CSSProperties,
  video: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } satisfies CSSProperties,
  /** 本端预览水平镜像（人照镜子的习惯）；远端不镜像。 */
  videoMirrored: { transform: 'scaleX(-1)' } satisfies CSSProperties,

  /**
   * 名字牌与静音角标同在**左下角一行**（v3.2 改）。
   *
   * 静音角标原先在右上角，而 1v1 的全屏画面铺满整屏——那个位置正好压在手机状态栏的
   * 时间与电量上。离左边与下边都留 12（原来是 8）：格子有 10 的圆角，贴到 8 的话
   * 名字会被圆角切掉一截，窄格子上直接看不全。
   */
  tileBottomRow: {
    position: 'absolute', left: 12, bottom: 12, right: 12, display: 'flex', gap: 4,
    alignItems: 'center', pointerEvents: 'none',
  } satisfies CSSProperties,
  tileLabel: {
    height: 20, padding: '0 8px', borderRadius: 6, minWidth: 0,
    background: callColors.scrim, fontSize: 12, display: 'flex', gap: 6, alignItems: 'center',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  } satisfies CSSProperties,
  /** 正在说话：名字标签底变绿、字变深（规范 §06）。 */
  tileLabelSpeaking: { background: callColors.accept, color: callColors.acceptFg, fontWeight: 600 } satisfies CSSProperties,

  /**
   * 静音角标**跟着名字牌走，在它右边**（v3.2 改，原来在右上角）。
   *
   * 1v1 的全屏画面铺满整屏，右上角那个位置正好压在系统状态栏的时间与电量上（手机端）。
   */
  tileBadge: {
    flex: '0 0 auto', width: 20, height: 20, borderRadius: '50%',
    background: callColors.scrim, display: 'flex', alignItems: 'center',
    justifyContent: 'center', color: callColors.mutedBadge,
  } satisfies CSSProperties,
  tileNetBadge: {
    position: 'absolute', right: 12, top: 12, width: 24, height: 24, borderRadius: '50%',
    background: callColors.scrim, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: callColors.warning,
  } satisfies CSSProperties,

  avatar: {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: callColors.fg, background: callColors.avatar,
  } satisfies CSSProperties,
  avatarDisc: {
    width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 15, fontWeight: 700,
  } satisfies CSSProperties,

  /** 小窗（本端或互换后的对端）。位置由 `layout/pip.ts` 算，这里只有外观。 */
  pip: {
    position: 'absolute', borderRadius: callMetrics.pipRadius, overflow: 'hidden', background: callColors.tile,
    border: '1.5px solid rgba(255,255,255,0.55)', boxShadow: '0 10px 26px rgba(0,0,0,0.45)',
    cursor: 'pointer', padding: 0, touchAction: 'none', userSelect: 'none', zIndex: 2,
  } satisfies CSSProperties,
  pipDragging: { transform: 'scale(1.04)', boxShadow: '0 18px 40px rgba(0,0,0,0.6)', cursor: 'grabbing' } satisfies CSSProperties,
  pipCornerGhost: {
    position: 'absolute', borderRadius: callMetrics.pipRadius, border: '1.5px dashed rgba(255,255,255,0.35)',
    pointerEvents: 'none', zIndex: 1,
  } satisfies CSSProperties,

  controls: {
    height: callMetrics.controlsHeight, flex: 'none', display: 'flex', gap: callMetrics.controlGap,
    justifyContent: 'center', alignItems: 'flex-start', padding: '4px 0 0',
  } satisfies CSSProperties,
  /** 视频页的控制条垫一层透明 → 黑 55% 的渐变，否则浅色画面上白图标看不见。 */
  controlsOnVideo: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3,
    background: 'linear-gradient(transparent, rgba(0,0,0,0.55))', padding: '14px 0 12px',
  } satisfies CSSProperties,

  /*
    圆形控制按钮：**圆里图标、圆下文字**。数值与 iOS 的 IMKitTheme 一一对应
    （56 的圆、0.14 的半透明底、开启态白底黑字），两端长得一样。
  */
  controlButton: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: callMetrics.captionGap,
    border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: 'inherit',
    font: 'inherit', width: 64,
  } satisfies CSSProperties,

  controlCircle: {
    borderRadius: '50%', flex: '0 0 auto',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: callColors.ctlIdle, color: callColors.fg,
  } satisfies CSSProperties,

  controlCaption: {
    fontSize: 11, lineHeight: 1.2, color: callColors.fgDim, textAlign: 'center',
  } satisfies CSSProperties,

  /** 页内小窗：180 宽，视频 16:9 + 底栏 36（规范 §04）。位置由 `layout/pip.ts` 算。 */
  mini: {
    position: 'fixed', zIndex: 9000, width: callMetrics.miniWidth,
    background: callColors.overlay, color: callColors.fg, borderRadius: 12, overflow: 'hidden',
    boxShadow: '0 6px 24px rgba(0,0,0,0.35)', cursor: 'pointer', touchAction: 'none', userSelect: 'none',
    font: `13px/1.4 ${callFont}`,
  } satisfies CSSProperties,
  miniVideo: { height: Math.round((callMetrics.miniWidth * 9) / 16), borderRadius: 0, outline: 'none' } satisfies CSSProperties,
  miniBody: {
    height: callMetrics.miniBar, padding: '0 10px', display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', fontVariantNumeric: 'tabular-nums',
  } satisfies CSSProperties,
  miniEnd: {
    border: 'none', cursor: 'pointer', color: callColors.fg, background: callColors.danger,
    borderRadius: 999, padding: '3px 10px', fontSize: 11, font: 'inherit',
  } satisfies CSSProperties,

  /** 来电横幅：左右各留 8、高 62、圆角 16（规范 §06）。 */
  toast: {
    position: 'fixed', top: 8, left: 8, right: 8, margin: '0 auto', maxWidth: 420, zIndex: 9100,
    minHeight: callMetrics.bannerHeight, background: callColors.banner, color: callColors.fg, borderRadius: 16,
    padding: '10px 10px 10px 12px', boxShadow: '0 14px 34px rgba(0,0,0,0.45)', display: 'flex', gap: 10,
    alignItems: 'center', font: `14px/1.5 ${callFont}`,
  } satisfies CSSProperties,
  toastAvatar: {
    width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 13, fontWeight: 700, flex: 'none',
  } satisfies CSSProperties,
  toastText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  toastActions: { marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' } satisfies CSSProperties,

  /** 顶部橙条：正在重连 / 对方网络不佳（规范 §08）。 */
  topBanner: {
    position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 4,
    background: callColors.warning, color: callColors.overlaySolid, borderRadius: 999, padding: '4px 12px',
    fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
  } satisfies CSSProperties,

  /** 提示卡（权限前置说明 / 被拒提示）：宽 270、圆角 16，两个横排动作（规范 §06）。 */
  dimmer: {
    position: 'fixed', inset: 0, zIndex: 9200, background: 'rgba(8,10,16,0.42)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', font: `14px/1.5 ${callFont}`,
  } satisfies CSSProperties,
  card: {
    width: 270, borderRadius: 16, overflow: 'hidden', background: callColors.banner, color: callColors.fg,
    boxShadow: '0 22px 55px rgba(0,0,0,0.4)', textAlign: 'center',
  } satisfies CSSProperties,
  cardBody: { padding: '18px 17px 14px' } satisfies CSSProperties,
  cardTitle: { fontSize: 16, fontWeight: 700, margin: '0 0 6px' } satisfies CSSProperties,
  cardText: { fontSize: 15, color: callColors.fgDim, margin: 0, lineHeight: 1.5 } satisfies CSSProperties,
  cardActions: { display: 'flex', borderTop: '1px solid rgba(255,255,255,0.12)' } satisfies CSSProperties,
  cardAction: {
    flex: 1, padding: '11px 4px', fontSize: 15, border: 'none', background: 'none', cursor: 'pointer',
    color: callColors.fg, font: 'inherit',
  } satisfies CSSProperties,
  cardActionStrong: { fontWeight: 700 } satisfies CSSProperties,

  /** 成员选择：半屏（桌面上是居中卡片），顶部圆角 20（规范 §06）。 */
  sheet: {
    position: 'fixed', left: 0, right: 0, bottom: 0, margin: '0 auto', maxWidth: 480, height: '62%',
    zIndex: 9200, background: callColors.banner, color: callColors.fg, borderRadius: '20px 20px 0 0',
    boxShadow: '0 -14px 40px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column',
    font: `14px/1.5 ${callFont}`,
  } satisfies CSSProperties,
  sheetHeader: { padding: '12px 14px 8px', display: 'flex', alignItems: 'center', gap: 8 } satisfies CSSProperties,
  sheetSearch: {
    margin: '0 14px 8px', height: 32, borderRadius: 9, border: 'none', padding: '0 10px', fontSize: 13,
    background: callColors.ctlIdle, color: callColors.fg, font: 'inherit',
  } satisfies CSSProperties,
  sheetList: { flex: 1, overflowY: 'auto', minHeight: 0 } satisfies CSSProperties,
  sheetRow: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', fontSize: 13.5, width: '100%',
    border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left',
  } satisfies CSSProperties,
  sheetRowDim: { opacity: 0.45, cursor: 'default' } satisfies CSSProperties,
  sheetCheck: {
    marginLeft: 'auto', width: 20, height: 20, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.35)',
    flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
  } satisfies CSSProperties,
  sheetCheckOn: { background: callColors.accept, borderColor: callColors.accept, color: callColors.acceptFg } satisfies CSSProperties,
  sheetGo: {
    margin: '8px 14px 16px', height: 44, borderRadius: 12, border: 'none', cursor: 'pointer',
    background: callColors.accept, color: callColors.acceptFg, fontWeight: 700, fontSize: 15, font: 'inherit',
  } satisfies CSSProperties,
  sheetGoDisabled: { background: callColors.ctlIdle, color: callColors.fgDim, cursor: 'default' } satisfies CSSProperties,

  smallButton: {
    padding: '8px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
    background: callColors.ctlIdle, color: callColors.fg, fontSize: 13, font: 'inherit',
  } satisfies CSSProperties,
};
