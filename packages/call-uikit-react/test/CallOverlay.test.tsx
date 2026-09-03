import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CallProvider } from '../src/CallProvider.js';
import { CallOverlay } from '../src/components/CallOverlay.js';
import { FakeEngine, asEngine } from './fakeEngine.js';

/**
 * uikit 的时序与订阅行为**必须在 jsdom 里测**（CONVENTIONS §9）。
 *
 * 姊妹项目为此空跑过一整轮：浏览器里靠肉眼是看不出「事件订阅没清理」的，
 * 表现只是第二次通话开始重复计数，而那时已经很难回溯到根因了。
 */

function setup(endedHoldMs = 0): FakeEngine {
  const engine = new FakeEngine();
  render(
    <CallProvider engine={asEngine(engine)} endedHoldMs={endedHoldMs}>
      <CallOverlay />
    </CallProvider>,
  );
  return engine;
}

/** ring 让来电响起来。 */
function ring(engine: FakeEngine, isGroup = false): void {
  act(() => {
    engine.emit('callReceived', {
      callId: 'c-1', caller: 'alice', mediaType: 'video', isGroup,
    });
  });
}

/** connect 把通话推到「通话中」。 */
function connect(engine: FakeEngine, isGroup = false): void {
  act(() => {
    engine.emit('callBegin', {
      callId: 'c-1', roomId: 'r-1', mediaType: 'video', isGroup, role: 'callee',
    });
    engine.emit('roomJoined', { roomId: 'r-1' });
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CallOverlay 按阶段显示', () => {
  it('没有通话时什么都不画——宿主的界面不该被我们盖住', () => {
    setup();
    expect(screen.queryByTestId('incoming-call')).toBeNull();
    expect(screen.queryByTestId('active-call')).toBeNull();
  });

  it('来电时出浮层，接听调 engine.accept', () => {
    const engine = setup();
    ring(engine);

    expect(screen.getByTestId('incoming-call').textContent).toContain('alice');
    fireEvent.click(screen.getByTestId('accept-call'));
    expect(engine.calls).toContain('accept');
  });

  it('拒接调 engine.reject', () => {
    const engine = setup();
    ring(engine);
    fireEvent.click(screen.getByTestId('reject-call'));
    expect(engine.calls).toContain('reject');
  });

  it('接通后进通话界面，并把本端媒体发布出去', async () => {
    const engine = setup();
    ring(engine);
    connect(engine);

    expect(screen.getByTestId('active-call')).toBeTruthy();
    // 发布是两次 await，要把微任务放完再断言。
    await act(async () => {
      await Promise.resolve();
    });
    // engine 会自动进房但**不会自动推流**——推流是界面的决定。
    expect(engine.calls).toContain('publishMic');
    expect(engine.calls).toContain('publishCam');
  });

  it('挂断在接通前后调的是不同的帧（协议 §4.4）', () => {
    const engine = setup();
    ring(engine);
    // 来电阶段点挂断 = 拒接
    fireEvent.click(screen.getByTestId('reject-call'));
    expect(engine.calls).toEqual(['reject']);

    connect(engine);
    fireEvent.click(screen.getByTestId('end-call'));
    expect(engine.calls).toContain('hangup');
  });

  it('小窗收起与展开', () => {
    const engine = setup();
    ring(engine);
    connect(engine);

    fireEvent.click(screen.getByTestId('minimize'));
    expect(screen.getByTestId('mini-window')).toBeTruthy();
    expect(screen.queryByTestId('active-call')).toBeNull();

    fireEvent.click(screen.getByTestId('mini-window'));
    expect(screen.getByTestId('active-call')).toBeTruthy();
  });

  it('结束后停留一会儿再收起（草图 §09 那个 1.5 秒的方框）', async () => {
    const engine = setup(30);
    ring(engine);
    connect(engine);
    act(() => {
      engine.emit('callEnd', { callId: 'c-1', reason: 'hangup', durationSec: 3, endedBy: 'alice' });
    });
    // 先停在结束态给用户看一眼，而不是画面「啪」地消失。
    expect(screen.getByTestId('active-call').textContent).toContain('通话结束');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(screen.queryByTestId('active-call')).toBeNull();
  });
});

describe('九宫格与层上界', () => {
  it('人多了就报低层——这是省带宽的地方', () => {
    const engine = setup();
    ring(engine, true);
    connect(engine, true);
    act(() => {
      for (const uid of ['bob', 'carol', 'dave', 'erin']) {
        engine.emit('userEnter', { uid });
      }
    });

    // alice + 四个人 + 自己 = 6 格 → 缩略图档
    const reported = new Map(engine.layers.map((l) => [l.uid, l.layer]));
    expect(reported.get('bob')).toBe('l');
    expect(reported.get('alice')).toBe('l');
  });

  it('1v1 对端满屏，报最高层', () => {
    const engine = setup();
    ring(engine);
    connect(engine);
    expect(engine.layers.at(-1)).toEqual({ uid: 'alice', layer: 'h' });
  });

  it('主讲人高亮跟着 activeSpeakers 走，名单空了要灭', () => {
    const engine = setup();
    ring(engine, true);
    connect(engine, true);
    act(() => {
      engine.emit('activeSpeakers', { speakers: [{ uid: 'alice', volume: 70 }] });
    });
    expect(screen.getByTestId('tile-alice').textContent).toContain('🔊');

    act(() => {
      engine.emit('activeSpeakers', { speakers: [] });
    });
    expect(screen.getByTestId('tile-alice').textContent).not.toContain('🔊');
  });
});

describe('清理', () => {
  it('卸载时事件订阅要清干净', () => {
    const engine = new FakeEngine();
    const view = render(
      <CallProvider engine={asEngine(engine)}>
        <CallOverlay />
      </CallProvider>,
    );
    expect(engine.listenerCount()).toBeGreaterThan(0);

    view.unmount();
    expect(engine.listenerCount()).toBe(0);
  });

  it('格子卸载时要把画面从元素上摘掉，否则解码器还占着', () => {
    const engine = setup();
    ring(engine);
    connect(engine);
    expect(engine.attached.some((a) => a.uid === 'alice' && a.hasElement)).toBe(true);

    act(() => {
      engine.emit('userLeave', { uid: 'alice' });
    });
    expect(engine.attached.some((a) => a.uid === 'alice' && !a.hasElement)).toBe(true);
  });
});
