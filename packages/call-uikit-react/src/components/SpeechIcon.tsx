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
 * 与 `AudioStage` 的呼吸动画同一个做法；`id` 去重，多个格子只注入一次。
 */
const KEYFRAMES = `
@keyframes imrtc-talk{0%,100%{transform:scaleY(.34)}50%{transform:scaleY(1)}}
@media (prefers-reduced-motion:reduce){.imrtc-bar{animation:none!important;transform:scaleY(.7)}}
`;

const wrap: CSSProperties = {
  width: W, height: H, flex: 'none', display: 'flex', alignItems: 'center',
  justifyContent: 'space-between',
};

export interface SpeechIconProps {
  readonly speaking: boolean;
  readonly muted: boolean;
  /** 0~100，映射到峰值高度。安静时也别缩成一条线，所以有个 50% 的底。 */
  readonly volume?: number;
  readonly testUid?: string;
}

export function SpeechIcon({ speaking, muted, volume = 0, testUid = '' }: SpeechIconProps): JSX.Element {
  // **静音优先**：静音的人不可能在说话，两者互斥。
  if (muted) {
    return (
      <span style={wrap} role="img" aria-label="已静音" data-testid={`muted-${testUid}`}>
        <svg width={W} height={H} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 1.6a2 2 0 0 1 2 2v3.1L6 3.9V3.6a2 2 0 0 1 2-2Z" fill="currentColor" />
          <path d="M6 6.9v1.5a2 2 0 0 0 3.1 1.67L10.2 11.2A3.9 3.9 0 0 1 4.1 8V7.3" fill="currentColor" />
          <path d="M8 12v2.4M5.8 14.4h4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M2.4 2.1l11.2 11.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (!speaking) return <span style={wrap} aria-hidden="true" />;

  const peak = 0.5 + 0.5 * Math.min(Math.max(volume, 0), 100) / 100;
  return (
    <>
      <style id="imrtc-talk-keyframes">{KEYFRAMES}</style>
      <span style={wrap} role="img" aria-label="正在说话" data-testid={`speaking-${testUid}`}>
        {DELAYS.map((delay, i) => (
          <i
            key={i}
            className="imrtc-bar"
            style={{
              display: 'block', width: BAR, height: H, borderRadius: BAR / 2,
              background: callColors.accept, transformOrigin: '50% 50%',
              transform: `scaleY(${peak})`,
              animation: `imrtc-talk ${callMotion.speakingPeriodMs}ms ease-in-out ${delay} infinite`,
            }}
          />
        ))}
      </span>
    </>
  );
}
