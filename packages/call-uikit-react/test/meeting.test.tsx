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

/*
  M2 分页画廊（MEETING_ROOM_DESIGN §4.1 / §4.4 / §4.6）。

  M1 那枚「还有 N 人未显示」胶囊**由页码取代**（§4.5）：看得见的人有格子，
  看不见的人报 `none`（引擎在会议房里会把它翻译成「五秒后退订」）。
*/
describe('会议房分页画廊', () => {
  /** fill 让 n 个远端进房。 */
  function fill(engine: FakeEngine, n: number): void {
    act(() => {
      for (let i = 1; i <= n; i++) engine.emit('userEnter', { uid: `u${i}` });
    });
  }

  /** swipe 在舞台上左右滑一下：dx < 0 = 看下一页。 */
  function swipe(dx: number): void {
    const stage = screen.getByTestId('meeting-stage');
    act(() => {
      fireEvent.pointerDown(stage, { clientX: 200, clientY: 100 });
      fireEvent.pointerUp(stage, { clientX: 200 + dx, clientY: 100 });
    });
  }

  it('9 人以内不分页，和群通话完全一样', async () => {
    const engine = setup();
    await enterMeeting(engine);
    fill(engine, 8);
    expect(screen.queryByTestId('page-indicator'), '一页装得下就不该有页码').toBeNull();
    expect(screen.queryByTestId('meeting-stage'), '也不该挂手势层').toBeNull();
    expect(screen.getByTestId('tile-u8')).toBeTruthy();
  });

  it('超过一屏：页码取代胶囊，页外的人报 none', async () => {
    const engine = setup();
    await enterMeeting(engine);
    fill(engine, 10);

    expect(screen.queryByTestId('hidden-count'), 'M1 的胶囊已经退役').toBeNull();
    expect(screen.getByTestId('page-indicator').textContent).toBe('1 / 2');
    expect(screen.getByTestId('tile-u8')).toBeTruthy();
    expect(screen.queryByTestId('tile-u9'), '第二页的人这一屏上没有格子').toBeNull();
    expect(engine.layers).toContainEqual({ uid: 'u9', layer: 'none' });
    expect(engine.layers).toContainEqual({ uid: 'u10', layer: 'none' });
    expect(engine.layers).not.toContainEqual({ uid: 'u1', layer: 'none' });
  });

  it('左滑翻到第二页：新页的人有格子，第一页的人改报 none', async () => {
    const engine = setup();
    await enterMeeting(engine);
    fill(engine, 10);
    swipe(-120);

    expect(screen.getByTestId('page-indicator').textContent).toBe('2 / 2');
    expect(screen.getByTestId('tile-u9')).toBeTruthy();
    expect(screen.queryByTestId('tile-u1')).toBeNull();
    expect(engine.layers).toContainEqual({ uid: 'u1', layer: 'none' });

    // 右滑回来。
    swipe(120);
    expect(screen.getByTestId('page-indicator').textContent).toBe('1 / 2');
    expect(screen.getByTestId('tile-u1')).toBeTruthy();
  });

  it('滑得不够远不翻页——点一下不该翻页', async () => {
    const engine = setup();
    await enterMeeting(engine);
    fill(engine, 10);
    swipe(-10);
    expect(screen.getByTestId('page-indicator').textContent).toBe('1 / 2');
  });

  it('人走光之后页码收得回来，不会停在一个不存在的页上', async () => {
    const engine = setup();
    await enterMeeting(engine);
    fill(engine, 10);
    swipe(-120);
    expect(screen.getByTestId('page-indicator').textContent).toBe('2 / 2');

    act(() => {
      engine.emit('userLeave', { uid: 'u9' });
      engine.emit('userLeave', { uid: 'u10' });
    });
    expect(screen.queryByTestId('page-indicator'), '只剩 8 个远端，不再分页').toBeNull();
    expect(screen.getByTestId('tile-u1')).toBeTruthy();
  });
});

describe('会议房：钉住与演讲者视图', () => {
  it('双击一格进演讲者视图，点 📌 回画廊', async () => {
    const engine = setup();
    await enterMeeting(engine);
    act(() => {
      for (let i = 1; i <= 5; i++) engine.emit('userEnter', { uid: `u${i}` });
    });

    act(() => {
      fireEvent.doubleClick(screen.getByTestId('tile-u2'));
    });
    expect(screen.getByTestId('speaker-stage')).toBeTruthy();
    // 主画面报 h（§4.4）。
    expect(engine.layers).toContainEqual({ uid: 'u2', layer: 'h' });
    // 底部条只有 4 格（自己 + 3 位），第 5 个人没上去，要报 none。
    expect(engine.layers).toContainEqual({ uid: 'u5', layer: 'none' });

    act(() => {
      fireEvent.click(screen.getByTestId('unpin'));
    });
    expect(screen.queryByTestId('speaker-stage')).toBeNull();
    expect(screen.getByTestId('grid-stage')).toBeTruthy();
  });

  it('钉住的人走了，自动回到画廊', async () => {
    const engine = setup();
    await enterMeeting(engine);
    act(() => {
      engine.emit('userEnter', { uid: 'u1' });
      engine.emit('userEnter', { uid: 'u2' });
    });
    act(() => {
      fireEvent.doubleClick(screen.getByTestId('tile-u1'));
    });
    expect(screen.getByTestId('speaker-stage')).toBeTruthy();

    act(() => {
      engine.emit('userLeave', { uid: 'u1' });
    });
    expect(screen.queryByTestId('speaker-stage'), '不能一直盯着一个不在房里的人').toBeNull();
  });
});

describe('会议房：只读成员列表', () => {
  it('标题栏的 👥 打开列表：自己在第一行，其余按进房顺序，带麦克风 / 摄像头状态', async () => {
    const engine = setup();
    await enterMeeting(engine);
    act(() => {
      engine.emit('userEnter', { uid: 'u1' });
      engine.emit('userEnter', { uid: 'u2' });
      engine.emit('userAudioAvailable', { uid: 'u2', available: false });
    });

    act(() => {
      fireEvent.click(screen.getByTestId('members-button'));
    });
    const list = screen.getByTestId('member-list');
    expect(list.textContent).toContain('成员（3）');

    const rows = [...list.querySelectorAll('[data-testid^="member-"]')]
      .map((el) => el.getAttribute('data-testid'))
      .filter((id): id is string =>
        id !== null && !id.endsWith('-mic') && !id.endsWith('-cam') && id !== 'member-list-close');
    expect(rows, '自己第一行，其余按进房顺序').toEqual(['member-self', 'member-u1', 'member-u2']);
    expect(screen.getByTestId('member-u2-mic').getAttribute('data-on')).toBe('false');
    expect(screen.getByTestId('member-u1-mic').getAttribute('data-on')).toBe('true');

    act(() => {
      fireEvent.click(screen.getByTestId('member-list-close'));
    });
    expect(screen.queryByTestId('member-list')).toBeNull();
  });
});
