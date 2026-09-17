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
 * describePlayFailure 把 `audio.play()` 的 reject 归成日志级别与说法。
 * `isStopped` 为 true 表示收尾的 `pause()` 已经跑过：此时的失败都是本端收铃打断的，与浏览器策略无关。
 */
export function describePlayFailure(
  err: unknown,
  isStopped: boolean,
): { readonly level: 'debug' | 'warn'; readonly message: string } {
  const name = err instanceof Error || err instanceof DOMException ? err.name : '';
  if (isStopped || name === 'AbortError') {
    return { level: 'debug', message: '提示音还没开始播放就被收掉了（快速接听 / 挂断），不是自动播放拦截' };
  }
  if (name === 'NotAllowedError') {
    return { level: 'warn', message: '提示音自动播放被浏览器拦下（没有用户手势），静音继续通话' };
  }
  return { level: 'warn', message: '提示音播放失败（资源加载或解码出错），静音继续通话' };
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
 *
 * **只有 `NotAllowedError` 才是「被拦下」**。快速挂断时 `play()` 还没落定就被收尾的
 * `pause()` 打断，promise 以 `AbortError` reject——那是本端自己收的铃，不是浏览器拦的，
 * 记成「自动播放被拦下」会把排障的人带偏（见 `describePlayFailure`）。
 */
export function useRingtone({ engine, state, muted, incomingRingtone, ringbackTone }: RingtoneDeps): void {
  const kind = ringtoneFor(state, muted);

  useEffect(() => {
    if (kind === 'none') return;
    const src = kind === 'incoming' ? (incomingRingtone ?? DEFAULT_INCOMING_RINGTONE) : (ringbackTone ?? DEFAULT_RINGBACK_TONE);
    const audio = new Audio(src);
    audio.loop = true;
    let isStopped = false;
    audio.play().catch((err: unknown) => {
      // 一律接住，别让它变成未处理的 rejection；是不是「被拦下」由 describePlayFailure 分。
      const { level, message } = describePlayFailure(err, isStopped);
      logger[level](message, { kind, err: String(err) });
    });
    return () => {
      isStopped = true;
      audio.pause();
      audio.currentTime = 0;
    };
    // engine 只用来在换实例时让这一路提示音跟着停，见上面字段注释。
  }, [kind, incomingRingtone, ringbackTone, engine]);
}
