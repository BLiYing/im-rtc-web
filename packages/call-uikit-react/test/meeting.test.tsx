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
    <button
      type="button"
      data-testid="join"
      // 宿主的拨号面板就是这么写的（Demo 的 `guard`）：接住错误显示出来，别让它成为 unhandled。
      onClick={() => void actions.joinMeeting('r-9', 'tk').catch(() => undefined)}
    >
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
    expect(screen.getByTestId('call-ended').textContent).toContain('已离开会议');
  });

  it('服务端单方面关房（roomClosed）同样收界面', async () => {
    const engine = setup();
    await enterMeeting(engine);

    act(() => {
      engine.emit('roomClosed', { roomId: 'r-9', reason: 'closed' });
    });
    expect(screen.getByTestId('call-ended').textContent).toContain('已离开会议');
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

/*
  先摆界面再进房是对的（不然点下去几百毫秒没反应），但**进房这一步抛了就得把界面收回来**。

  真 engine 的 `joinRoom` 会同步抛 1004：`checkRoomId` 拦下带空格 / 中文的房间号，
  而「拿群名当房间号」正是宿主最常见的写法。不收的话界面永远停在「正在进入会议…」——
  既没有 roomLeft 也没有 callEnd，红按钮走 leaveRoom 又被房间机以 2005 本地拒掉，
  宿主拨号面板的 `busy` 还把所有按钮一起禁死，只能刷新页面。
*/
describe('进房抛错要把界面收回来', () => {
  it('joinRoom 抛 1004：不留在「正在进入会议…」那一屏', async () => {
    const engine = new FakeEngine();
    engine.joinRoomError = new Error('bad_params(1004): room_id 只允许 [A-Za-z0-9_-]');
    render(
      <CallProvider engine={asEngine(engine)} endedHoldMs={0}>
        <JoinButton />
        <CallOverlay />
      </CallProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('join'));
    });

    expect(engine.calls).toContain('join:r-9');
    expect(screen.queryByTestId('active-call'), '界面必须收掉，否则退不出去').toBeNull();
  });

  /*
    **进房成功之后的失败不能收界面**——那时人已经在房里了，收掉等于把一场还在进行的
    会议从屏幕上抹掉。麦克风推流失败只出提示。
  */
  it('进房成功、麦克风推不上：留在会议里，出一条提示', async () => {
    const engine = new FakeEngine();
    engine.publishMicError = new Error('device_not_found(2002)');
    render(
      <CallProvider engine={asEngine(engine)} endedHoldMs={0}>
        <JoinButton />
        <CallOverlay />
      </CallProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('join'));
    });
    act(() => {
      engine.emit('roomJoined', { roomId: 'r-9' });
    });

    expect(screen.getByTestId('active-call'), '人已经在房里了，不能把界面抹掉').toBeTruthy();
    expect(screen.getByTestId('active-call').textContent).toContain('麦克风打不开');
    // 麦克风塌了也要接着推摄像头——只丢声音，别把画面一起丢了。
    expect(engine.calls).toContain('publishCam');
  });
});
