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
function ring(engine: FakeEngine, isGroup = false, mediaType = 'video'): void {
  act(() => {
    engine.emit('callReceived', {
      callId: 'c-1', caller: 'alice', mediaType, isGroup,
    });
  });
}

/** connect 把通话推到「通话中」。 */
function connect(engine: FakeEngine, isGroup = false, mediaType = 'video'): void {
  act(() => {
    engine.emit('callBegin', {
      callId: 'c-1', roomId: 'r-1', mediaType, isGroup, role: 'callee',
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

  it('来电时出浮层，接听调 engine.accept', async () => {
    const engine = setup();
    ring(engine);

    expect(screen.getByTestId('incoming-call').textContent).toContain('alice');
    fireEvent.click(screen.getByTestId('accept-call'));
    // 接听前先起本端预览（视频来电），所以 accept 落在下一个微任务上。
    await act(async () => {
      await Promise.resolve();
    });
    expect(engine.calls).toContain('startLocalPreview');
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
    // 先停在结束画面给用户看一眼，而不是画面「啪」地消失。
    // **它是独立的一屏**：通话页那排「静音 / 关摄像头 / 小窗 / 挂断」不该出现在这里。
    expect(screen.getByTestId('call-ended').textContent).toContain('通话结束');
    expect(screen.queryByTestId('active-call')).toBeNull();
    expect(screen.queryByTestId('toggle-mic')).toBeNull();
    expect(screen.queryByTestId('end-call')).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(screen.queryByTestId('call-ended')).toBeNull();
  });

  /*
    还在响铃的来电结束时**直接收起，不留结束画面**。

    原先统一进 ended，而 ended 又落在 ActiveCall 上，于是来电浮层当场变成通话页
    （静音 / 关摄像头 / 小窗 / 挂断那一排全出来了），停一两秒再消失。
    实测反馈：「为何还弹出一个那个接通才有的界面」。
  */
  it('对方取消时来电界面直接消失，不闪一下通话页', () => {
    const engine = setup(3000);
    ring(engine);
    expect(screen.getByTestId('incoming-call')).toBeTruthy();

    act(() => {
      engine.emit('callEnd', { callId: 'c-1', reason: 'cancel', durationSec: 0, endedBy: 'alice' });
    });

    expect(screen.queryByTestId('incoming-call')).toBeNull();
    expect(screen.queryByTestId('call-ended')).toBeNull();
    expect(screen.queryByTestId('active-call')).toBeNull();
  });

  /// 主叫那一侧相反：**没打通更要说清为什么**，所以停一下。
  it('拨出去没人接时，主叫看得到原因', () => {
    const engine = setup(3000);
    act(() => {
      engine.emit('callBegin', {
        callId: 'c-2', roomId: 'r-2', mediaType: 'audio', isGroup: false, role: 'caller',
      });
      engine.emit('callEnd', { callId: 'c-2', reason: 'no_answer', durationSec: 0, endedBy: '' });
    });
    expect(screen.getByTestId('call-ended').textContent).toContain('对方无人接听');
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

/*
  语音通话里**不给摄像头按钮**。

  协议上没有「转视频」这回事：media_type 只在 invite 时定死，进了房房间就不认识它。
  原先那个按钮是半实现——点了确实出镜、对方确实看得见，而本端预览的 cid 在这条路上
  压根没记进视图状态，于是**自己不知道自己已经出镜了**。
*/
describe('摄像头按钮什么时候有', () => {
  it('语音通话里没有', () => {
    const engine = setup();
    ring(engine, false, 'audio');
    connect(engine, false, 'audio');
    expect(screen.queryByTestId('toggle-camera')).toBeNull();
    // 麦克风与挂断照旧。
    expect(screen.getByTestId('toggle-mic')).toBeTruthy();
    expect(screen.getByTestId('end-call')).toBeTruthy();
  });

  it('视频通话里有；把摄像头关掉之后仍然有', () => {
    const engine = setup();
    ring(engine);
    connect(engine);
    expect(screen.getByTestId('toggle-camera')).toBeTruthy();

    fireEvent.click(screen.getByTestId('toggle-camera'));
    // 判据是 media_type，不是「本端摄像头开没开」——对方本来就知道这是视频通话。
    expect(screen.getByTestId('toggle-camera')).toBeTruthy();
  });
});
