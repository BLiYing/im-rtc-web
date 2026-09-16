import type { CallEngine } from 'im-rtc-call-engine';
import { logger } from 'im-rtc-call-engine';
import { useEffect } from 'react';

import { DEFAULT_INCOMING_RINGTONE, DEFAULT_RINGBACK_TONE } from './audio/ringtoneAssets.js';
import { ringtoneFor } from './state/callView.js';
import type { CallViewState } from './state/viewTypes.js';

/** RingtoneDeps 是 useRingtone 的依赖。 */
export interface RingtoneDeps {
  /**
   * **只作为「换实例就停干净」的依赖，播放本身不碰它**：`new Audio()` 与 engine 无关，
   * 与远端轨道的 `engine.attachView` 体系是两条路。留着这个字段是为了在宿主中途换
   * `engine`（多开 / 重登）时也能让上一路铃声跟着停，不留一段孤儿音频。
   */
  readonly engine: CallEngine;
  readonly state: CallViewState;
  /** 宿主传的 `ringtoneMuted`：true 时来电铃声、回铃音都不响。 */
  readonly muted: boolean;
  /** 来电铃声的 URL，不传用内置默认（`DEFAULT_INCOMING_RINGTONE`）。 */
  readonly incomingRingtone?: string;
  /** 回铃音的 URL，不传用内置默认（`DEFAULT_RINGBACK_TONE`）。 */
  readonly ringbackTone?: string;
}

/**
 * useRingtone 在来电 / 呼出阶段起提示音（草图 §01/§02）：骨架复刻 `useRingingPreview.ts`
 * ——同一套「按 phase 起副作用、离开时收」的写法。
 *
 * 播放用 `new Audio()`，**不接进 `engine.attachView` 体系**——那一套是给远端媒体轨道用的，
 * 提示音是本地资源，没有 track，接不上也不该接。
 *
 * # 自动播放策略（Web 端的既知限制，不是 bug）
 *
 * 来电时通常没有用户手势，浏览器的自动播放策略会让 `audio.play()` 返回的 promise reject。
 * 这里**只 `logger.warn`**：不置任何用户可见的错误态，不 `alert`（CONVENTIONS §8）。
 * 静音继续通话——用户看得见来电页/来电横幅，只是听不到响铃，这与「无权限播放视频只是没画面」
 * 同一个道理（`useRingingPreview` 的预览失败也是同样处理成不阻断通话）。
 */
export function useRingtone({ engine, state, muted, incomingRingtone, ringbackTone }: RingtoneDeps): void {
  const kind = ringtoneFor(state, muted);

  useEffect(() => {
    if (kind === 'none') return;
    const src = kind === 'incoming' ? (incomingRingtone ?? DEFAULT_INCOMING_RINGTONE) : (ringbackTone ?? DEFAULT_RINGBACK_TONE);
    const audio = new Audio(src);
    audio.loop = true;
    audio.play().catch((err: unknown) => {
      // Safari / Chrome 的自动播放策略会拒掉没有用户手势的 play()——接住，别让它变成未处理的 rejection。
      logger.warn('提示音自动播放被浏览器拦下（没有用户手势），静音继续通话', { kind, err: String(err) });
    });
    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
    // engine 只用来在换实例时让这一路提示音跟着停，见上面字段注释。
  }, [kind, incomingRingtone, ringbackTone, engine]);
}
