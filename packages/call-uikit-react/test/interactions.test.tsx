import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, RtcError } from '@im-rtc/call-engine';

import { CallProvider } from '../src/CallProvider.js';
import { CallOverlay } from '../src/components/CallOverlay.js';
import { FakeEngine, asEngine } from './fakeEngine.js';

/**
 * 交互稿 §03–§05 的手势与流程：A/B 互换、小窗拖动吸角、九宫格加人、顶部横幅。
 * **一律在 jsdom 里测**（CONVENTIONS §9）：拖动吸到哪个角靠肉眼是看不准的。
 */

function setup(candidates?: readonly { uid: string; name?: string }[]): FakeEngine {
  const engine = new FakeEngine();
  render(
    <CallProvider engine={asEngine(engine)} endedHoldMs={0}
      {...(candidates === undefined ? {} : { inviteCandidates: candidates })}>
      <CallOverlay />
    </CallProvider>,
  );
  return engine;
}

/** connectAs 直接把通话推到「通话中」。role 决定是不是主叫。 */
function connectAs(engine: FakeEngine, role: 'caller' | 'callee', isGroup: boolean, mediaType = 'video'): void {
  act(() => {
    engine.emit('callBegin', { callId: 'c-1', roomId: 'r-1', mediaType, isGroup, role });
    engine.emit('roomJoined', { roomId: 'r-1' });
    engine.emit('userEnter', { uid: 'bob' });
  });
}

const mouse = { pointerId: 1, pointerType: 'mouse' };
function drag(el: HTMLElement, from: [number, number], to: [number, number]): void {
  fireEvent.pointerDown(el, { ...mouse, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(el, { ...mouse, clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2 });
  fireEvent.pointerMove(el, { ...mouse, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(el, { ...mouse, clientX: to[0], clientY: to[1] });
}
function tap(el: HTMLElement): void {
  fireEvent.pointerDown(el, { ...mouse, clientX: 5, clientY: 5 });
  fireEvent.pointerUp(el, { ...mouse, clientX: 5, clientY: 5 });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
});

describe('1v1 视频：A/B 互换与小窗拖动', () => {
  function videoCall(): FakeEngine {
    const engine = setup();
    connectAs(engine, 'callee', false);
    act(() => {
      engine.emit('userVideoAvailable', { uid: 'bob', available: true });
    });
    return engine;
  }

  it('单击小窗互换，层上界跟着换：进小窗的报 l，上全屏的报 h', () => {
    const engine = videoCall();
    expect(screen.getByTestId('video-stage').getAttribute('data-swapped')).toBe('false');
    expect(engine.layers.at(-1)).toEqual({ uid: 'bob', layer: 'h' });

    const callsBefore = engine.calls.length;
    tap(screen.getByTestId('pip'));
    expect(screen.getByTestId('video-stage').getAttribute('data-swapped')).toBe('true');
    // 对端进了小窗：这个尺寸给 h 层是纯烧带宽。
    expect(engine.layers.at(-1)).toEqual({ uid: 'bob', layer: 'l' });
    // 互换是纯本端行为，不发任何帧。
    expect(engine.calls.length).toBe(callsBefore);

    tap(screen.getByTestId('pip'));
    expect(screen.getByTestId('video-stage').getAttribute('data-swapped')).toBe('false');
    expect(engine.layers.at(-1)).toEqual({ uid: 'bob', layer: 'h' });
  });

  it('鼠标直接拖：拖过去松手吸到最近的角；拖了就不算单击', () => {
    videoCall();
    const pip = screen.getByTestId('pip');
    expect(pip.getAttribute('data-corner')).toBe('top-right');

    // jsdom 里容器量出来是 0×0，位置被夹在 (0,0)、中心落在右下——只验「拖了 → 吸角 → 不互换」这条逻辑。
    drag(pip, [300, 40], [20, 600]);
    expect(pip.getAttribute('data-corner')).toBe('bottom-right');
    expect(screen.getByTestId('video-stage').getAttribute('data-swapped')).toBe('false');
  });

  it('触摸要长按 350ms 才进拖动态；没到就动了既不拖也不算单击', () => {
    vi.useFakeTimers();
    try {
      videoCall();
      const pip = screen.getByTestId('pip');
      const touch = { pointerId: 2, pointerType: 'touch' };

      // 没长按就滑：什么都不发生。
      fireEvent.pointerDown(pip, { ...touch, clientX: 300, clientY: 40 });
      fireEvent.pointerMove(pip, { ...touch, clientX: 200, clientY: 300 });
      fireEvent.pointerUp(pip, { ...touch, clientX: 200, clientY: 300 });
      expect(screen.getByTestId('video-stage').getAttribute('data-swapped')).toBe('false');
      expect(pip.getAttribute('data-corner')).toBe('top-right');

      // 长按到点再滑：拖动 → 吸角。
      fireEvent.pointerDown(pip, { ...touch, clientX: 300, clientY: 40 });
      act(() => {
        vi.advanceTimersByTime(400);
      });
      fireEvent.pointerMove(pip, { ...touch, clientX: 20, clientY: 600 });
      fireEvent.pointerUp(pip, { ...touch, clientX: 20, clientY: 600 });
      expect(pip.getAttribute('data-corner')).toBe('bottom-right');
    } finally {
      vi.useRealTimers();
    }
  });

  /*
    对端关了摄像头、自己也没画面时**仍然留在视频版式**。

    原先是退回语音版式，实测下来不对：小窗整个消失，用户以为通话断了，
    而且关掉摄像头之后就再也点不到「互换」。没画面是格子的事，不是版式的事——
    格子里换成头像盘就够了。
  */
  it('两端都关了摄像头，仍留在视频版式、小窗还在', () => {
    const engine = videoCall();
    expect(screen.getByTestId('active-call').getAttribute('data-layout')).toBe('video');
    act(() => {
      engine.emit('userVideoAvailable', { uid: 'bob', available: false });
    });
    expect(screen.getByTestId('active-call').getAttribute('data-layout')).toBe('video');
    expect(screen.getByTestId('pip')).toBeTruthy();
  });
});

describe('页内小窗', () => {
  it('拖动吸角并记住；刷新后仍在那个角', () => {
    const engine = setup();
    connectAs(engine, 'callee', false, 'audio');
    fireEvent.click(screen.getByTestId('minimize'));
    const mini = screen.getByTestId('mini-window');
    expect(mini.getAttribute('data-corner')).toBe('bottom-right');

    // jsdom 的视口是 1024×768：往左上拖到头，中心落在左上半区。
    drag(mini, [900, 700], [10, 10]);
    expect(mini.getAttribute('data-corner')).toBe('top-left');
    expect(sessionStorage.getItem('im-rtc.mini-corner')).toBe('top-left');

    // 小窗里挂断走的是红按钮自己的动作，不会冒泡成「展开」。
    fireEvent.click(screen.getByTestId('mini-end'));
    expect(engine.calls).toContain('hangup');
    expect(screen.queryByTestId('active-call')).toBeNull();
  });
});

describe('九宫格加人', () => {
  it('入口只有右上角那一颗：网格里没有加号格，被叫连按钮也没有', () => {
    const engine = setup();
    connectAs(engine, 'caller', true);
    expect(screen.getByTestId('invite-button')).toBeTruthy();
    // **网格里不许再有第二个入口**（v3.3 撤掉加号格）：同一个动作两处入口，
    // 而且它会占掉一个格位——三个人的通话看起来像四个人。
    expect(screen.queryByTestId('invite-tile')).toBeNull();

    act(() => {
      engine.emit('callEnd', { callId: 'c-1', reason: 'hangup', durationSec: 1, endedBy: 'me' });
    });
    connectAs(engine, 'callee', true);
    expect(screen.queryByTestId('invite-button')).toBeNull();
  });

  it('选人 → 邀请：占位格立刻出现，帧随后发；已在通话中的人置灰不可选', async () => {
    const engine = setup([{ uid: 'bob' }, { uid: 'dave', name: '戴夫' }]);
    connectAs(engine, 'caller', true);

    fireEvent.click(screen.getByTestId('invite-button'));
    expect(screen.getByTestId('invite-slots').textContent).toContain('还能加 7 人');
    expect(screen.getByTestId('invite-row-bob').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('invite-row-bob').textContent).toContain('已在通话中');

    fireEvent.click(screen.getByTestId('invite-row-dave'));
    expect(screen.getByTestId('invite-go').textContent).toBe('邀请 1 人');
    fireEvent.click(screen.getByTestId('invite-go'));
    await flush();

    expect(screen.queryByTestId('invite-picker')).toBeNull();
    expect(engine.calls).toContain('inviteMore:dave');
    expect(screen.getByTestId('ringing-dave').textContent).toBe('呼叫中…');
  });

  it('宿主没给名单：输入 uid 也能邀请', async () => {
    const engine = setup();
    connectAs(engine, 'caller', true);
    fireEvent.click(screen.getByTestId('invite-button'));
    fireEvent.change(screen.getByTestId('invite-search'), { target: { value: 'erin' } });
    fireEvent.click(screen.getByTestId('invite-typed'));
    fireEvent.click(screen.getByTestId('invite-go'));
    await flush();
    expect(engine.calls).toContain('inviteMore:erin');
  });

  it('被邀请的人拒了：格子先写「已拒绝」，2s 后才收', () => {
    vi.useFakeTimers();
    try {
      const engine = setup([{ uid: 'dave' }]);
      connectAs(engine, 'caller', true);
      fireEvent.click(screen.getByTestId('invite-button'));
      fireEvent.click(screen.getByTestId('invite-row-dave'));
      fireEvent.click(screen.getByTestId('invite-go'));

      act(() => {
        engine.emit('userReject', { uid: 'dave' });
      });
      expect(screen.getByTestId('ringing-dave').textContent).toBe('已拒绝');
      act(() => {
        vi.advanceTimersByTime(2100);
      });
      expect(screen.queryByTestId('tile-dave')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('服务端说不是主叫（1407）→ 入口藏掉；满员（1202）→ 提示', () => {
    const engine = setup();
    connectAs(engine, 'caller', true);
    act(() => {
      engine.emit('error', { code: ErrorCode.roomFull, name: 'room_full', message: '' });
    });
    expect(screen.getByTestId('active-call').textContent).toContain('通话已满员');

    act(() => {
      engine.emit('error', { code: ErrorCode.notCallOwner, name: 'not_call_owner', message: '' });
    });
    expect(screen.queryByTestId('invite-button')).toBeNull();
  });

  it('群通话的红按钮写「离开」', () => {
    const engine = setup();
    connectAs(engine, 'caller', true);
    expect(screen.getByTestId('end-call').textContent).toContain('离开');
  });
});

describe('顶部横幅', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('断线 → 正在重连…；连上 → 消失；通话不结束', () => {
    const engine = setup();
    connectAs(engine, 'callee', false, 'audio');
    act(() => {
      engine.emit('disconnected', { code: 1006, willReconnect: true });
    });
    expect(screen.getByTestId('banner-reconnecting')).toBeTruthy();
    expect(screen.getByTestId('active-call')).toBeTruthy();

    act(() => {
      engine.emit('connected', { sessionId: 's-2', resumed: true });
    });
    expect(screen.queryByTestId('banner-reconnecting')).toBeNull();
  });

  it('对方网络差：横幅 2s 后收成角标，不一直霸占顶部', () => {
    const engine = setup();
    connectAs(engine, 'callee', false);
    act(() => {
      engine.emit('userVideoAvailable', { uid: 'bob', available: true });
      engine.emit('networkQuality', { entries: [{ uid: 'bob', level: 5 }] });
    });
    expect(screen.getByTestId('banner-network')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.queryByTestId('banner-network')).toBeNull();
    expect(screen.getByTestId('net-bob')).toBeTruthy();
  });
});

/*
  三条「失败路径没人收尾」的回归（都是 /code-review 抓出来的）：
  开摄像头失败、加人被服务端拒、一次性提示永久顶掉计时器。
*/
describe('失败路径要收尾', () => {
  it('开摄像头失败：按钮弹回去、标成无权限，而不是假装开着', async () => {
    const engine = setup();
    // 用户刚在系统设置里关掉了摄像头：这一下 publish 会抛 2001。
    engine.publishCameraError = new RtcError(ErrorCode.devicePermissionDenied);
    connectAs(engine, 'callee', false, 'video');

    // 接通时摄像头是关着的（来电页上关掉了），点开才会去发布。
    fireEvent.click(screen.getByTestId('toggle-camera'));
    await flush();

    expect(engine.calls).toContain('publishCam');
    const camera = screen.getByTestId('toggle-camera');
    // **不能停在「已开启」**：那样用户以为自己出镜了，而对端什么也没收到。
    expect(camera.getAttribute('aria-disabled')).toBe('true');
    expect(camera.textContent).toContain('无权限');
  });

  it('加人被拒：占位格要收回来，不能一直挂着「呼叫中…」', async () => {
    const engine = setup([{ uid: 'dave' }]);
    engine.inviteMoreError = new RtcError(ErrorCode.notCallOwner);
    connectAs(engine, 'caller', true);

    fireEvent.click(screen.getByTestId('invite-button'));
    fireEvent.click(screen.getByTestId('invite-row-dave'));
    fireEvent.click(screen.getByTestId('invite-go'));
    await flush();

    expect(engine.calls).toContain('inviteMore:dave');
    expect(screen.queryByTestId('tile-dave')).toBeNull();
  });

  it('提示停几秒就撤，计时器要回来', () => {
    vi.useFakeTimers();
    try {
      const engine = setup();
      connectAs(engine, 'caller', true);
      act(() => {
        engine.emit('error', { code: ErrorCode.roomFull, name: 'room_full', message: '' });
      });
      expect(screen.getByTestId('active-call').textContent).toContain('通话已满员');

      act(() => {
        vi.advanceTimersByTime(3100);
      });
      // 提示撤掉之后，副标题回到时长（00:0x）。
      expect(screen.getByTestId('active-call').textContent).not.toContain('通话已满员');
      expect(screen.getByTestId('active-call').textContent).toMatch(/00:\d\d/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('两个人先后拒接：先拒的那格不会被后拒的重新计时', () => {
    vi.useFakeTimers();
    try {
      const engine = setup([{ uid: 'dave' }, { uid: 'erin' }]);
      connectAs(engine, 'caller', true);
      // 用「加人」把两个人摆成占位格（未接听），终局才有意义。
      fireEvent.click(screen.getByTestId('invite-button'));
      fireEvent.click(screen.getByTestId('invite-row-dave'));
      fireEvent.click(screen.getByTestId('invite-row-erin'));
      fireEvent.click(screen.getByTestId('invite-go'));
      act(() => {
        engine.emit('userReject', { uid: 'dave' });
      });
      act(() => {
        vi.advanceTimersByTime(1900);
        engine.emit('userReject', { uid: 'erin' });
      });
      // dave 的 2 秒到点就该走，不该被 erin 那条重置。
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByTestId('tile-dave')).toBeNull();
      expect(screen.queryByTestId('tile-erin')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('通话中来了第二通电话', () => {
  /*
    真机日志 08:30:39：bob 正在和 alice 通话，ivan 打进来，服务端判忙线后发来一条
    `call.ended{busy}`——那条帧的 call_id 是**新来那通**的。状态机不看 call_id 时，
    它会被当成「当前通话结束了」，媒体面全关、通话页收起，而对面还显示着通话中。

    MVP 是单通道：不弹第二个来电窗，只在当前通话页上提示一句谁来过电话。
  */
  it('只提示「谁来电，已自动回复忙线」，当前通话纹丝不动', () => {
    const engine = setup();
    connectAs(engine, 'callee', false, 'video');
    act(() => {
      engine.emit('callMissed', { callId: 'c-2', caller: 'ivan', reason: 'busy' });
    });
    expect(screen.getByTestId('active-call')).toBeTruthy();
    expect(screen.getByText('ivan 来电，已自动回复忙线')).toBeTruthy();
  });
});

describe('群通话的被叫也要看到还没接的人', () => {
  /*
    `call.incoming` 一直带着 callee_ids，只是原先没人往上抛：主叫那边是四格
    （含还没接的占位格），被叫这边只有两格，同一通电话两种样子。
  */
  it('来电时按 callee_ids 摆占位格，并去掉自己', () => {
    const engine = setup();
    act(() => {
      engine.emit('callReceived', {
        callId: 'c-1', caller: 'alice', calleeIds: ['me', 'carol', 'dave'],
        mediaType: 'video', isGroup: true,
      });
      engine.emit('callBegin', { callId: 'c-1', roomId: 'r-1', mediaType: 'video', isGroup: true, role: 'callee' });
      engine.emit('roomJoined', { roomId: 'r-1' });
    });
    expect(screen.getByTestId('tile-alice')).toBeTruthy();
    expect(screen.getByTestId('tile-carol')).toBeTruthy();
    expect(screen.getByTestId('tile-dave')).toBeTruthy();
    // FakeEngine.uid 是 'me'——自己不是远端成员（本端那一格的 testid 是 tile-self）。
    expect(screen.queryByTestId('tile-me')).toBeNull();
  });
});
