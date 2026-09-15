import type { CallEndReasonValue } from '@im-rtc/call-engine';

import type { CallViewState } from './state/viewTypes.js';

/**
 * 红键按下之后**盯着这一屏到底走没走**；到点还在原地，就让调用方本地收场。
 *
 * # 为什么需要它
 *
 * 发出去的那一帧未必真的发得出去、也未必有人应。2026-09-13 iOS frank 接听后卡在「接通中…」，
 * 按红键发出的 `call.hangup` 一帧没到服务端，界面停在原地。用户按红键时的意图没有歧义：
 * **把我弄出去**——这条路必须在本地就能走完，不许依赖服务端应答。
 *
 * 到点之后调用方做两件事：界面本地收场，再调 `engine.forceEnd()` 让引擎也离场
 * （只收界面的话，引擎还留在通话与房间里，别人一直看得见他）。
 *
 * 与 Android `IMRedButtonWatchdog`、iOS `IMCallController.armEndWatchdog` 同义同时长。
 *
 * # 为什么单独成类
 *
 * 计时器经 {@link Schedule} 注入，单测拿一个假调度器就能把「按下 → 没人应 → 本地收场」
 * 和「按下 → 收到终态 → 不该收场」两条路都走一遍，不必真的等 3 秒。
 */

/** END_WATCHDOG_MS 是按下红键后等结束事件的最长时间。正常路径上 hangup.ok 与 call.ended 都在百毫秒级。 */
export const END_WATCHDOG_MS = 3_000;

/** Schedule 延时执行 `run`，返回撤销函数。 */
export type Schedule = (delayMs: number, run: () => void) => () => void;

/** timerSchedule 是浏览器里的真身。 */
export const timerSchedule: Schedule = (delayMs, run) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

/** RedButtonWatchdog 一次只盯一个动作——红键一次只按得下一个，重复按只留最后一次。 */
export class RedButtonWatchdog {
  private cancel: (() => void) | null = null;

  constructor(
    private readonly schedule: Schedule = timerSchedule,
    readonly timeoutMs: number = END_WATCHDOG_MS,
  ) {}

  /** isArmed 此刻盯着没有。给测试与日志看。 */
  get isArmed(): boolean {
    return this.cancel !== null;
  }

  /** arm 开始盯。`onExpire` 在到点时执行；它自己再判断「这一屏是不是真的还没走」。 */
  arm(onExpire: () => void): void {
    this.disarm();
    this.cancel = this.schedule(this.timeoutMs, () => {
      this.cancel = null;
      onExpire();
    });
  }

  /** disarm 撤掉。这一屏已经走了（或从头就没武装过）时调用，**重复调用无害**。 */
  disarm(): void {
    this.cancel?.();
    this.cancel = null;
  }
}

/** EndAction 是红键此刻该发的动作。 */
export type EndAction = 'leaveRoom' | 'reject' | 'cancel' | 'hangup';

/**
 * endActionFor：红键在**四种场合是四个不同的动作**，分辨这件事是 uikit 的责任。
 * 最容易错的是会议——**会议房里没有 call**，发 hangup 会被通话机本地拒成 2005。
 * 与 iOS `imEndAction` 同一张表。
 */
export function endActionFor(state: CallViewState): EndAction {
  if (state.isMeeting) return 'leaveRoom';
  if (state.phase === 'incoming') return 'reject';
  if (state.phase === 'outgoing') return 'cancel';
  return 'hangup';
}

/**
 * endWatchdogReason：本地收场时写哪个结束原因。**照红键实际发出去的那个动作写**，
 * 不写 network——那一刻网络多半是好的，写「网络中断」是在冤枉网络（iOS `imEndWatchdogReason` 同义）。
 */
export function endWatchdogReason(action: EndAction): CallEndReasonValue {
  if (action === 'cancel') return 'cancel';
  if (action === 'reject') return 'reject';
  return 'hangup';
}
