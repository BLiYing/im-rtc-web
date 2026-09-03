import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CallProvider } from '../src/CallProvider.js';
import { CallOverlay } from '../src/components/CallOverlay.js';
import { useCall } from '../src/useCall.js';
import { FakeEngine, asEngine } from './fakeEngine.js';

/**
 * 会议房（`joinMeeting`）与振铃通话是两条不同的生命周期。
 *
 * 这一组用例守的是三人会议实测撞出来的那个坑：**会议里没有 call**，
 * 红按钮走 `hangup` 会被状态机本地拒成 2005——界面上就是「点挂断没反应、退不出房间」。
 */

/** JoinButton 是测试用的宿主：uikit 没有「进会议」的按钮，那是宿主的界面。 */
function JoinButton(): ReactNode {
  const { actions } = useCall();
  return (
    <button type="button" data-testid="join" onClick={() => void actions.joinMeeting('r-9', 'tk')}>
      进会议
    </button>
  );
}

function setup(): FakeEngine {
  const engine = new FakeEngine();
  render(
    <CallProvider engine={asEngine(engine)} endedHoldMs={0}>
      <JoinButton />
      <CallOverlay />
    </CallProvider>,
  );
  return engine;
}

/** enterMeeting 进会议并把媒体接通。 */
async function enterMeeting(engine: FakeEngine): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('join'));
  });
  act(() => {
    engine.emit('roomJoined', { roomId: 'r-9' });
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('会议房的进出', () => {
  it('红按钮走 leaveRoom 而不是 hangup——会议里根本没有 call', async () => {
    const engine = setup();
    await enterMeeting(engine);

    expect(screen.getByTestId('active-call')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('end-call'));
    });

    expect(engine.calls).toContain('leaveRoom');
    // 发了 hangup 就等于回到那个 bug：状态机会本地拒掉，界面纹丝不动。
    expect(engine.calls).not.toContain('hangup');
  });

  it('roomLeft 到了才进结束态——会议没有 callEnd，漏订阅就等于没有出口', async () => {
    const engine = setup();
    await enterMeeting(engine);

    act(() => {
      engine.emit('roomLeft', { roomId: 'r-9' });
    });
    // 和通话一样先停在结束画面，再由 endedHoldMs 收走（这里 0 = 不自动收）。
    expect(screen.getByTestId('active-call').textContent).toContain('已离开会议');
  });

  it('服务端单方面关房（roomClosed）同样收界面', async () => {
    const engine = setup();
    await enterMeeting(engine);

    act(() => {
      engine.emit('roomClosed', { roomId: 'r-9', reason: 'closed' });
    });
    expect(screen.getByTestId('active-call').textContent).toContain('已离开会议');
  });

  it('结束画面停留之后自己收掉，界面不会一直挂着', async () => {
    vi.useFakeTimers();
    try {
      const engine = new FakeEngine();
      render(
        <CallProvider engine={asEngine(engine)} endedHoldMs={1500}>
          <JoinButton />
          <CallOverlay />
        </CallProvider>,
      );
      await act(async () => {
        fireEvent.click(screen.getByTestId('join'));
      });
      act(() => {
        engine.emit('roomJoined', { roomId: 'r-9' });
        engine.emit('roomLeft', { roomId: 'r-9' });
      });
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(screen.queryByTestId('active-call')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('会议只推一次流：joinMeeting 推过之后 effect 不再重复推', async () => {
    const engine = setup();
    await enterMeeting(engine);

    expect(engine.calls.filter((c) => c === 'publishMic')).toHaveLength(1);
    expect(engine.calls.filter((c) => c === 'publishCam')).toHaveLength(1);
  });

  it('红按钮在会议里写「离开」，标题写「会议」', async () => {
    const engine = setup();
    await enterMeeting(engine);

    expect(screen.getByTestId('end-call').textContent).toBe('离开');
    expect(screen.getByTestId('active-call').textContent).toContain('会议');
  });
});

describe('静音角标', () => {
  it('远端静音时格子上有角标，取消静音后消失', async () => {
    const engine = setup();
    await enterMeeting(engine);
    act(() => {
      engine.emit('userEnter', { uid: 'bob' });
    });

    // 默认不显示：`userAudioAvailable` 只在变化时才抛，一开始就正常的人没有事件。
    expect(screen.queryByTestId('muted-bob')).toBeNull();

    act(() => {
      engine.emit('userAudioAvailable', { uid: 'bob', available: false });
    });
    expect(screen.getByTestId('muted-bob')).toBeTruthy();

    act(() => {
      engine.emit('userAudioAvailable', { uid: 'bob', available: true });
    });
    expect(screen.queryByTestId('muted-bob')).toBeNull();
  });

  it('本端静音时自己的格子也有角标——本端读的是开关，不是回调', async () => {
    const engine = setup();
    await enterMeeting(engine);

    expect(screen.queryByTestId('muted-self')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-mic'));
    });
    expect(screen.getByTestId('muted-self')).toBeTruthy();
  });
});
