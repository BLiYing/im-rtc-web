import { describe, expect, it } from 'vitest';

import type { Schedule } from '../src/redButtonWatchdog.js';
import { END_WATCHDOG_MS, RedButtonWatchdog, endActionFor, endWatchdogReason } from '../src/redButtonWatchdog.js';
import { initialCallView, reduceCallView } from '../src/state/callView.js';

/** 红键看门狗的纯逻辑。计时器注入，**不真的等 3 秒**（与 Android `IMRedButtonWatchdogTest` 同义）。 */

class FakeSchedule {
  readonly entries: { delayMs: number; run: () => void; cancelled: boolean }[] = [];
  readonly schedule: Schedule = (delayMs, run) => {
    const entry = { delayMs, run, cancelled: false };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  /** fire 让所有还没撤的计时器到点。 */
  fire(): void {
    for (const entry of this.entries) if (!entry.cancelled) entry.run();
  }
}

describe('RedButtonWatchdog', () => {
  it('按下 → 没人应 → 到点执行一次', () => {
    const clock = new FakeSchedule();
    const watchdog = new RedButtonWatchdog(clock.schedule);
    let expired = 0;
    watchdog.arm(() => {
      expired += 1;
    });
    expect(watchdog.isArmed).toBe(true);
    expect(clock.entries[0]?.delayMs).toBe(END_WATCHDOG_MS);

    clock.fire();
    expect(expired).toBe(1);
    expect(watchdog.isArmed).toBe(false);
  });

  it('按下 → 这一屏走了（撤掉）→ 到点不执行', () => {
    const clock = new FakeSchedule();
    const watchdog = new RedButtonWatchdog(clock.schedule);
    let expired = 0;
    watchdog.arm(() => {
      expired += 1;
    });
    watchdog.disarm();
    watchdog.disarm(); // 重复撤无害
    clock.fire();
    expect(expired).toBe(0);
  });

  it('连按两下只留最后一次——不许排两次收场', () => {
    const clock = new FakeSchedule();
    const watchdog = new RedButtonWatchdog(clock.schedule);
    const fired: string[] = [];
    watchdog.arm(() => fired.push('first'));
    watchdog.arm(() => fired.push('second'));
    clock.fire();
    expect(fired).toEqual(['second']);
  });
});

describe('红键动作与本地收场原因', () => {
  it('四种场合四个动作；会议里恒为 leaveRoom', () => {
    expect(endActionFor({ ...initialCallView, phase: 'incoming' })).toBe('reject');
    expect(endActionFor({ ...initialCallView, phase: 'outgoing' })).toBe('cancel');
    expect(endActionFor({ ...initialCallView, phase: 'connecting' })).toBe('hangup');
    expect(endActionFor({ ...initialCallView, phase: 'active' })).toBe('hangup');
    expect(endActionFor({ ...initialCallView, phase: 'active', isMeeting: true })).toBe('leaveRoom');
  });

  it('照实际发出去的动作写原因，不冤枉网络', () => {
    expect(endWatchdogReason('cancel')).toBe('cancel');
    expect(endWatchdogReason('reject')).toBe('reject');
    expect(endWatchdogReason('hangup')).toBe('hangup');
    expect(endWatchdogReason('leaveRoom')).toBe('hangup');
  });
});

describe('界面已收起时迟到的 callEnd', () => {
  it('不再弹结束画面（2026-09-13 14:58:21 iOS 那 1.5 秒闪屏）', () => {
    const begin = reduceCallView(initialCallView, {
      type: 'callBegin', callId: 'c-1', roomId: 'r-1', mediaType: 'video',
      isGroup: true, role: 'callee', nowMs: 100,
    });
    const ended = reduceCallView(begin, { type: 'callEnd', reason: 'hangup', durationSec: 0 });
    const dismissed = reduceCallView(ended, { type: 'dismiss' });
    const late = reduceCallView(dismissed, { type: 'callEnd', reason: 'hangup', durationSec: 5 });
    expect(late).toBe(dismissed);
    expect(late.phase).toBe('idle');
  });
});
