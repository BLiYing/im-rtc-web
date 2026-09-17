import { render } from '@testing-library/react';
import { useRef } from 'react';
import type { LogLevel } from 'im-rtc-call-engine';
import { setLogLevel, setLogSink } from 'im-rtc-call-engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CallViewState } from '../src/state/callView.js';
import { initialCallView } from '../src/state/callView.js';
import { describePlayFailure, useRingtone } from '../src/useRingtone.js';
import { FakeEngine, asEngine } from './fakeEngine.js';

/**
 * useRingtone 是纯副作用层（起铃 / 停铃）。判据本身（`ringtoneFor`）已经在
 * `callView.test.ts` 里逐条单测过——这里只断言「起了」「停了」这两件事真的驱动了
 * `<audio>` 的 `play()` / `pause()`，**不断言真的发出声音**（CLAUDE.md「完成的定义」
 * 第 5 条：时序类行为在 jsdom 里断言调用，不靠肉眼听）。
 *
 * `play`/`pause` 在 `test/setup.ts` 里已经整体 stub 过一次（jsdom 的 `play()` 不返回
 * Promise，直接 `.catch()` 会 TypeError）；这里每个用例前再换一份新的 `vi.fn()`，
 * 图的是能拿到「调用了几次、传了什么」这份干净的记录，不与别的用例互相污染。
 */

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

beforeEach(() => {
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  window.HTMLMediaElement.prototype.play = play;
  window.HTMLMediaElement.prototype.pause = pause;
});

function Harness({ state, muted = false }: { state: CallViewState; muted?: boolean }): null {
  // 同一份 engine 跨渲染保持同一个引用——测试关心的是「state 变了会不会起停铃」，
  // 不是「engine 本身换实例」那条独立分支（那条只在 CallProvider 换 engine 时触发）。
  const engine = useRef(asEngine(new FakeEngine())).current;
  useRingtone({
    engine,
    state,
    muted,
    incomingRingtone: 'blob:incoming-test',
    ringbackTone: 'blob:ringback-test',
  });
  return null;
}

const idle: CallViewState = initialCallView;
const incoming: CallViewState = { ...initialCallView, phase: 'incoming' };
const outgoing: CallViewState = { ...initialCallView, phase: 'outgoing' };

describe('useRingtone：起铃 / 停铃', () => {
  it('phase 变成 incoming：起铃（play 被调用一次）', () => {
    const { rerender } = render(<Harness state={idle} />);
    expect(play).not.toHaveBeenCalled();

    rerender(<Harness state={incoming} />);
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it('phase 从 incoming 离开（接通）：收铃（pause 被调用）', () => {
    const { rerender } = render(<Harness state={incoming} />);
    expect(play).toHaveBeenCalledTimes(1);

    rerender(<Harness state={{ ...incoming, phase: 'connecting' }} />);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('phase 变成 outgoing：起铃（回铃音）', () => {
    const { rerender } = render(<Harness state={idle} />);
    rerender(<Harness state={outgoing} />);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('muted 为 true：全程不起铃，哪怕正在来电', () => {
    render(<Harness state={incoming} muted />);
    expect(play).not.toHaveBeenCalled();
  });

  it('组件卸载时收铃', () => {
    const { unmount } = render(<Harness state={incoming} />);
    expect(play).toHaveBeenCalledTimes(1);

    unmount();
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('会议房不起铃：phase 恰好是 incoming 也不响', () => {
    render(<Harness state={{ ...incoming, isMeeting: true }} />);
    expect(play).not.toHaveBeenCalled();
  });
});

describe('describePlayFailure：play() 被拒的归类', () => {
  it('NotAllowedError 才算「自动播放被拦下」，记 warn', () => {
    const got = describePlayFailure(new DOMException('no gesture', 'NotAllowedError'), false);
    expect(got.level).toBe('warn');
    expect(got.message).toContain('自动播放被浏览器拦下');
  });

  it('AbortError 是本端 pause() 打断的，记 debug、不说「拦下」', () => {
    const got = describePlayFailure(new DOMException('interrupted by pause()', 'AbortError'), false);
    expect(got.level).toBe('debug');
    expect(got.message).not.toContain('拦下');
  });

  it('已经收铃之后的任何失败都记 debug', () => {
    expect(describePlayFailure(new DOMException('x', 'NotAllowedError'), true).level).toBe('debug');
  });

  it('其它错误（资源加载失败、非 Error 值）记 warn，但不冒充「拦下」', () => {
    for (const err of [new DOMException('bad src', 'NotSupportedError'), 'boom']) {
      const got = describePlayFailure(err, false);
      expect(got.level).toBe('warn');
      expect(got.message).not.toContain('拦下');
    }
  });
});

describe('useRingtone：快速挂断时 play() 被 pause() 打断', () => {
  const logs: { level: LogLevel; message: string }[] = [];

  beforeEach(() => {
    logs.length = 0;
    // 默认门槛是 info：不放开 debug，「记成 debug」和「根本没记」在 sink 这里分不出来。
    setLogLevel('debug');
    setLogSink((level, message) => logs.push({ level, message }));
  });
  afterEach(() => {
    setLogSink(null);
    setLogLevel('info');
  });

  it('卸载后 play() 以 AbortError 落定：不打「自动播放被拦下」的 warn', async () => {
    let rejectPlay: (err: unknown) => void = () => undefined;
    play.mockReturnValueOnce(new Promise((_, reject) => { rejectPlay = reject; }));
    const { unmount } = render(<Harness state={incoming} />);

    unmount();
    rejectPlay(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'));
    await new Promise((r) => setTimeout(r, 0));

    const ringtoneLogs = logs.filter((l) => l.message.startsWith('提示音'));
    expect(ringtoneLogs).toHaveLength(1);
    expect(ringtoneLogs[0]?.level).toBe('debug');
  });

  it('还在响铃阶段被浏览器拦下（NotAllowedError）：仍打 warn', async () => {
    play.mockRejectedValueOnce(new DOMException('no gesture', 'NotAllowedError'));
    render(<Harness state={incoming} />);
    await new Promise((r) => setTimeout(r, 0));

    expect(logs.some((l) => l.level === 'warn' && l.message.includes('自动播放被浏览器拦下'))).toBe(true);
  });
});
