import type { ReactNode } from 'react';

/**
 * 通话控制按钮的图标。**内联 SVG，不引图标库、不用 emoji。**
 *
 * # 为什么不用 emoji
 *
 * iOS 端踩过一次：拿 emoji 当图标（🎤 📷 🔊），真机上**渲染成一个个方框问号**——
 * emoji 的字形要靠字体回退，并不保证命中。Web 端虽然多半能显示，
 * 但同一套界面在两端长得不一样本身就是问题（四端行为一致是本产品的约束）。
 *
 * # 为什么不引图标库
 *
 * 四个图标而已，一个依赖换四个图标不划算；而且 uikit 是要发到 npm 的包，
 * 多一个运行时依赖就多一份宿主的构建负担。内联 SVG 还能跟着 `currentColor` 走，
 * 开/关两态换颜色不用换图。
 *
 * 命名对齐 iOS 那边的 SF Symbols（`mic.fill` / `mic.slash.fill` …），
 * 好让两端的按钮表一眼能对上。
 */
export type IconName =
  | 'mic'
  | 'mic-slash'
  | 'video'
  | 'video-slash'
  | 'minimize'
  | 'phone'
  | 'phone-down'
  | 'xmark';

/** Icon 画一个 26×26 的图标，颜色跟 `currentColor`。 */
export function Icon({ name }: { readonly name: IconName }): ReactNode {
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape(name)}
    </svg>
  );
}

function shape(name: IconName): ReactNode {
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
    case 'phone':
      return handset();
    case 'phone-down':
      // 挂断就是把听筒倒过来——与 iOS 的 `phone.down.fill` 同一个语义。
      return <g transform="rotate(135 12 12)">{handset()}</g>;
    case 'xmark':
      return <path d="M6 6l12 12M18 6 6 18" />;
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
