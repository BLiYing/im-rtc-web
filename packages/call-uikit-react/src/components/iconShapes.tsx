import type { ReactNode } from 'react';

/**
 * 图标的路径数据 —— 与设计稿《通话界面规范》§05 逐条一致，**四端唯一真相**：
 * iOS 优先用同名 SF Symbols，Android / Qt 直接用这份路径。四端图标长得不一样本身就是 bug。
 *
 * 24×24 网格、描边 1.8、圆头圆角、颜色跟 `currentColor`。这里只放形状，
 * 外框（`<svg>` 与描边属性）在 `Icon.tsx`。
 */

/** IconName 是全部图标。命名对齐 iOS 的 SF Symbols（`mic.fill` / `mic.slash.fill` …）。 */
export type IconName =
  | 'mic'
  | 'mic-slash'
  | 'video'
  | 'video-slash'
  | 'phone'
  | 'phone-down'
  | 'xmark'
  | 'minimize'
  | 'expand'
  | 'speaker'
  | 'speaker-slash'
  | 'camera-flip'
  | 'person-add'
  | 'plus'
  | 'chevron-down'
  | 'more'
  | 'screen-share'
  | 'grid'
  | 'settings';

/** iconShape 画一个图标的形状。 */
export function iconShape(name: IconName): ReactNode {
  switch (name) {
    case 'mic':
    case 'mic-slash':
      return (
        <>
          <rect x={9} y={2} width={6} height={12} rx={3} />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3" />
          <path d="M8.5 21h7" />
          {name === 'mic-slash' && <path d="M3 3 21 21" />}
        </>
      );
    case 'video':
    case 'video-slash':
      return (
        <>
          <rect x={2} y={6} width={13} height={12} rx={2.5} />
          <path d="M15 10.5 22 7v10l-7-3.5z" />
          {name === 'video-slash' && <path d="M3 3 21 21" />}
        </>
      );
    case 'phone':
      return handset();
    case 'phone-down':
      // 挂断就是把听筒倒过来——与 iOS 的 `phone.down.fill` 同一个语义。
      return <g transform="rotate(135 12 12)">{handset()}</g>;
    case 'xmark':
      return <path d="M6 6l12 12M18 6 6 18" />;
    case 'minimize':
      // 两支相向的箭头，对应 iOS 的 `arrow.down.right.and.arrow.up.left`。
      return (
        <>
          <path d="M10 4H4v6" />
          <path d="M4 4l6 6" />
          <path d="M14 20h6v-6" />
          <path d="M20 20l-6-6" />
        </>
      );
    case 'expand':
      return (
        <>
          <path d="M4 10V4h6" />
          <path d="M10 10 4 4" />
          <path d="M20 14v6h-6" />
          <path d="M14 14l6 6" />
        </>
      );
    case 'speaker':
    case 'speaker-slash':
      return (
        <>
          <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
          {name === 'speaker' ? (
            <>
              <path d="M17 8.5a5 5 0 0 1 0 7" />
              <path d="M19.5 6a8.5 8.5 0 0 1 0 12" />
            </>
          ) : (
            <path d="M17 9l5 6M22 9l-5 6" />
          )}
        </>
      );
    case 'camera-flip':
      return (
        <>
          <path d="M3 8h3l1.5-2h9L18 8h3v11H3z" />
          <circle cx={12} cy={13} r={3.2} />
          <path d="M9.6 11.2 12 13" />
          <path d="M20 4.5a8 8 0 0 0-5-1.5" />
        </>
      );
    case 'person-add':
      return (
        <>
          <circle cx={9} cy={8} r={3.6} />
          <path d="M2.6 20a6.6 6.6 0 0 1 12.8 0" />
          <path d="M19 8v7M15.5 11.5h7" />
        </>
      );
    case 'plus':
      return <path d="M12 5v14M5 12h14" />;
    case 'chevron-down':
      return <path d="M6 9l6 6 6-6" />;
    case 'more':
      return (
        <>
          <circle cx={5.5} cy={12} r={1.6} fill="currentColor" />
          <circle cx={12} cy={12} r={1.6} fill="currentColor" />
          <circle cx={18.5} cy={12} r={1.6} fill="currentColor" />
        </>
      );
    case 'screen-share':
      return (
        <>
          <rect x={3} y={4} width={18} height={13} rx={2} />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
          <path d="m9 12 3-3 3 3" />
          <path d="M12 9v5" />
        </>
      );
    case 'grid':
      return (
        <>
          <rect x={3} y={4} width={7.5} height={7.5} rx={1.6} />
          <rect x={13.5} y={4} width={7.5} height={7.5} rx={1.6} />
          <rect x={3} y={14.5} width={7.5} height={5.5} rx={1.6} />
          <rect x={13.5} y={14.5} width={7.5} height={5.5} rx={1.6} />
        </>
      );
    case 'settings':
      return (
        <>
          <circle cx={12} cy={12} r={3.2} />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
        </>
      );
  }
}

/** handset 是听筒轮廓；`phone` 与 `phone-down` 共用它。 */
function handset(): ReactNode {
  return (
    <path
      fill="currentColor"
      stroke="none"
      d="M7.2 3H4.3C3.6 3 3 3.6 3 4.3 3 13.5 10.5 21 19.7 21c.7 0 1.3-.6 1.3-1.3v-2.9
         c0-.6-.4-1.1-1-1.2l-3-.6c-.5-.1-1 .1-1.3.5l-1.1 1.4c-2.4-1.2-4.3-3.1-5.5-5.5
         l1.4-1.1c.4-.3.6-.8.5-1.3l-.6-3c-.1-.6-.6-1-1.2-1z"
    />
  );
}
