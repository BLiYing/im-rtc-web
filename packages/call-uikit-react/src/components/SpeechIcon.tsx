import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { callColors, callMotion } from '../theme.js';

/**
 * 名牌气泡里那枚说话 / 静音的小信号。**九宫格与会议里才有，1v1 不用**（2026-09-09 拍板）。
 *
 * # 为什么不是绿描边了
 *
 * 原先「谁在说话」是整格描边 + 绿底名牌：两处大面积色块同时变，视线被拽走；
 * 几个人轮流说话时整屏在闪。改成名字右边一枚 9×10 的图标之后，
 * 画面与名牌底色纹丝不动，**整格里唯一的绿就是这枚图标**。
 *
 * # 为什么是竖条不是麦克风
 *
 * 麦克风说的是「他有麦克风」，竖条说的是「他此刻正在出声」——而且能把音量编码进条高。
 *
 * # 永远占位
 *
 * 安静时什么都不画，但照样占 9×10（2026-09-09 拍板：留位）。
 * 不留位的话名字会随说话左右跳，比图标本身更晃眼。
 */

const W = 9;
const H = 10;
const BAR = 2;
/** 三根条的相位错开，不然是一起上下的一整块。 */
const DELAYS = ['-0.42s', '-0.14s', '-0.28s'];

/**
 * 动画要 keyframes，内联样式写不出来，所以注入一小段 `<style>`。
 *
 * **在模块级注入一次，不放在组件里。** React 18 不会按 `id` 去重
 * （那要 React 19 的 `precedence` 提升），三个人同时说话就会插进三个同 id 的
 * `<style>`——非法 HTML，`getElementById` 也变得有歧义。
 *
 * 峰值**必须走自定义属性 `--imrtc-peak`，不能靠内联 `transform`**。
 * 层叠里「动画产生的声明」压在普通声明之上，内联样式也算普通声明——
 * 只要 `imrtc-talk` 在跑，内联的 `transform: scaleY(peak)` 就是一条死规则，
 * 音量再大条高也不动（耳语与大喊画出来一模一样）。
 * 自定义属性不受这条影响：它在 keyframes 里就地取值，于是音量重新起作用。
 *
 * 减弱动态效果那条仍要 `!important`——它要压过的正是上面那个动画声明。
 */
const KEYFRAMES = `
@keyframes imrtc-talk{0%,100%{transform:scaleY(calc(var(--imrtc-peak,1)*.34))}50%{transform:scaleY(var(--imrtc-peak,1))}}
@media (prefers-reduced-motion:reduce){.imrtc-bar{animation:none!important;transform:scaleY(calc(var(--imrtc-peak,1)*.7))!important}}
`;

const STYLE_ID = 'imrtc-talk-keyframes';
if (typeof document !== 'undefined' && document.getElementById(STYLE_ID) === null) {
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
}

const wrap: CSSProperties = {
  width: W, height: H, flex: 'none', display: 'flex', alignItems: 'center',
  justifyContent: 'space-between',
};

/**
 * 静音图标要**自己带颜色**。它原先住在 `styles.tileBadge` 里，那儿设了
 * `color: callColors.mutedBadge`；搬进气泡之后 `currentColor` 会继承名牌的白，
 * 于是渲染成纯白——不再读作「警示」，也和 iOS / Android 的 `mutedBadge` 对不上。
 */
const mutedWrap: CSSProperties = { ...wrap, color: callColors.mutedBadge };

/** 常态那枚麦克风：低对比度的白，退到背景里。见 SpeechIcon 里那段注释。 */
const micOnWrap: CSSProperties = { ...wrap, color: callColors.fg, opacity: 0.45 };

export interface SpeechIconProps {
  readonly speaking: boolean;
  readonly muted: boolean;
  /**
   * 这一格要不要区分「在说话」。**本端那格传 false**——自己在不在说话自己知道，
   * 只需要表达麦克风开关（2026-09-09 拍板）。
   */
  readonly showsSpeaking?: boolean;
  /** 0~100，映射到峰值高度。安静时也别缩成一条线，所以有个 50% 的底。 */
  readonly volume?: number;
  readonly testUid?: string;
}

/**
 * useHeldSpeaking 把「正在说话」**起时立刻亮、停时拖一拍再灭**。
 *
 * 服务端 300ms 一次全量快照（协议 §3.5），一句话里的换气会让人短暂掉出名单——
 * 直接跟着灭就是闪烁，而消除闪烁正是这次改版的出发点。
 * 三端同为 400ms（web 记在 `callMotion.speakingOffMs`）。
 */
function useHeldSpeaking(speaking: boolean): boolean {
  const [held, setHeld] = useState(speaking);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (speaking) {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        timer.current = undefined;
      }
      setHeld(true);
      return undefined;
    }
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setHeld(false);
    }, callMotion.speakingOffMs);
    return () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, [speaking]);

  return held;
}

export function SpeechIcon(
  { speaking, muted, volume = 0, showsSpeaking = true, testUid = '' }: SpeechIconProps,
): JSX.Element {
  // **Hook 必须在任何提前 return 之前调**，所以拖拍算在最前面。
  const held = useHeldSpeaking(speaking && !muted && showsSpeaking);

  // **静音优先**：静音的人不可能在说话，两者互斥。
  if (muted) {
    return (
      <span style={mutedWrap} role="img" aria-label="已静音" data-testid={`muted-${testUid}`}>
        <svg width={W} height={H} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 1.6a2 2 0 0 1 2 2v3.1L6 3.9V3.6a2 2 0 0 1 2-2Z" fill="currentColor" />
          <path d="M6 6.9v1.5a2 2 0 0 0 3.1 1.67L10.2 11.2A3.9 3.9 0 0 1 4.1 8V7.3" fill="currentColor" />
          <path d="M8 12v2.4M5.8 14.4h4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M2.4 2.1l11.2 11.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  /*
    「麦克风开着、没在说话」——**常态，所以要退到背景里**。
    它挂在每一个格子上、绝大多数时候都在，画得太显眼就成了新的干扰源，
    而这次改版的出发点正是减少干扰。只有说话那枚是亮绿色。
  */
  if (!held) {
    return (
      <span style={micOnWrap} role="img" aria-label="麦克风已开启" data-testid={`micon-${testUid}`}>
        <svg width={W} height={H} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="6" y="1.6" width="4" height="7.2" rx="2" fill="currentColor" />
          <path d="M4.1 7.3V8a3.9 3.9 0 0 0 7.8 0v-.7" stroke="currentColor" strokeWidth="1.3"
                strokeLinecap="round" />
          <path d="M8 12v2.4M5.8 14.4h4.4" stroke="currentColor" strokeWidth="1.3"
                strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  const peak = 0.5 + 0.5 * Math.min(Math.max(volume, 0), 100) / 100;
  return (
    <span style={wrap} role="img" aria-label="正在说话" data-testid={`speaking-${testUid}`}>
      {DELAYS.map((delay, i) => (
        <i
          key={i}
          className="imrtc-bar"
          style={{
            display: 'block', width: BAR, height: H, borderRadius: BAR / 2,
            background: callColors.accept, transformOrigin: '50% 50%',
            // 峰值经自定义属性喂进 keyframes，见 KEYFRAMES 上面那段。
            '--imrtc-peak': peak,
            animation: `imrtc-talk ${callMotion.speakingPeriodMs}ms ease-in-out ${delay} infinite`,
          } as CSSProperties}
        />
      ))}
    </span>
  );
}
