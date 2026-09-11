import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallProvider } from '../src/CallProvider.js';
import { CallOverlay } from '../src/components/CallOverlay.js';
import type { CallViewState, ViewAction } from '../src/state/callView.js';
import { initialCallView, reduceCallView } from '../src/state/callView.js';
import { VIDEO_REVEAL_FALLBACK_MS } from '../src/useVideoRevealFallback.js';
import { FakeEngine, asEngine } from './fakeEngine.js';

/**
 * 对端关了摄像头再开：**新画面上屏之前格子继续盖着头像**（2026-09-11 web bob 看 iOS carol）。
 *
 * `<video>` 整通复用，元素上定格着关之前的最后一帧；按 `userVideoAvailable(true)` 立刻揭示，
 * 露出来的先是那张旧画面、几百毫秒后才换成新的——看上去就是「刷新了一下」。
 * Android 同一件事的用例在 `CallViewStateTest`。
 */

function run(actions: ViewAction[], from: CallViewState = initialCallView): CallViewState {
  return actions.reduce(reduceCallView, from);
}

const bob = (state: CallViewState) => state.participants.find((p) => p.uid === 'bob');
const video = (uid: string, available: boolean): ViewAction => ({ type: 'userVideo', uid, available });
const revealed = (uid: string): ViewAction => ({ type: 'videoRevealed', uid });

describe('开摄像头要等新画面上屏才揭示（reducer）', () => {
  it('开的那一下记成等待，画面到了才揭示；关掉清掉等待；再开再等', () => {
    let state = run([{ type: 'userEnter', uid: 'bob' }, video('bob', true)]);
    expect(bob(state)).toMatchObject({ hasVideo: true, isVideoPending: true });

    state = reduceCallView(state, revealed('bob'));
    expect(bob(state)).toMatchObject({ hasVideo: true, isVideoPending: false });

    state = reduceCallView(state, video('bob', false));
    expect(bob(state)).toMatchObject({ hasVideo: false, isVideoPending: false });

    state = reduceCallView(state, video('bob', true));
    expect(bob(state)?.isVideoPending, '关了再开：元素上是旧画面，要重新等').toBe(true);
  });

  it('已经在播时再报一次开，不回退成等待——否则格子无端闪回头像', () => {
    const state = run([{ type: 'userEnter', uid: 'bob' }, video('bob', true), revealed('bob'), video('bob', true)]);
    expect(bob(state)?.isVideoPending).toBe(false);
  });

  it('摄像头关着时来的画面信号不揭示任何东西；迟到的信号不把离开的人补回来', () => {
    const off = run([{ type: 'userEnter', uid: 'bob' }]);
    expect(reduceCallView(off, revealed('bob')), '没在等就原样返回').toBe(off);

    const left = run([{ type: 'userEnter', uid: 'bob' }, video('bob', true), { type: 'userLeave', uid: 'bob' }]);
    expect(reduceCallView(left, revealed('bob')).participants).toEqual([]);
  });
});

describe('开摄像头要等新画面上屏才揭示（格子）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  function groupCallWithBob(): FakeEngine {
    const engine = new FakeEngine();
    render(
      <CallProvider engine={asEngine(engine)} endedHoldMs={0}>
        <CallOverlay />
      </CallProvider>,
    );
    act(() => {
      engine.emit('callBegin', { callId: 'c-1', roomId: 'r-1', mediaType: 'video', isGroup: true, role: 'callee' });
      engine.emit('roomJoined', { roomId: 'r-1' });
      engine.emit('userEnter', { uid: 'bob' });
    });
    return engine;
  }

  const bobVideo = () => screen.getByTestId('tile-bob').querySelector('video');

  it('等画面时头像盖着、<video> 照样可见（藏起来浏览器就不报帧了）；画面到了揭开', () => {
    const engine = groupCallWithBob();
    act(() => engine.emit('userVideoAvailable', { uid: 'bob', available: true }));
    expect(screen.queryByTestId('cover-bob')).not.toBeNull();
    expect(bobVideo()?.style.visibility).toBe('visible');

    act(() => engine.emit('firstVideoFrame', { uid: 'bob', trackId: 't-1' }));
    expect(screen.queryByTestId('cover-bob')).toBeNull();

    act(() => engine.emit('userVideoAvailable', { uid: 'bob', available: false }));
    expect(screen.queryByTestId('cover-bob')).not.toBeNull();
    expect(bobVideo()?.style.visibility).toBe('hidden');
  });

  it(`画面迟迟不来（页面在后台不出帧）：${VIDEO_REVEAL_FALLBACK_MS}ms 兜底照样揭开`, () => {
    const engine = groupCallWithBob();
    act(() => engine.emit('userVideoAvailable', { uid: 'bob', available: true }));

    act(() => vi.advanceTimersByTime(VIDEO_REVEAL_FALLBACK_MS - 1));
    expect(screen.queryByTestId('cover-bob')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('cover-bob')).toBeNull();
  });

  it('画面先到了就撤掉兜底；关了再开重新计时', () => {
    const engine = groupCallWithBob();
    act(() => engine.emit('userVideoAvailable', { uid: 'bob', available: true }));
    act(() => engine.emit('firstVideoFrame', { uid: 'bob', trackId: 't-1' }));
    act(() => engine.emit('userVideoAvailable', { uid: 'bob', available: false }));
    act(() => vi.advanceTimersByTime(VIDEO_REVEAL_FALLBACK_MS - 500));

    act(() => engine.emit('userVideoAvailable', { uid: 'bob', available: true }));
    act(() => vi.advanceTimersByTime(600));
    expect(screen.queryByTestId('cover-bob'), '上一轮的计时器不该把这一轮提前揭开').not.toBeNull();
    act(() => vi.advanceTimersByTime(VIDEO_REVEAL_FALLBACK_MS));
    expect(screen.queryByTestId('cover-bob')).toBeNull();
  });
});
