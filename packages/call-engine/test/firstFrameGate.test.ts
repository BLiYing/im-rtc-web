import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallEngine } from '../src/engine.js';
import { videoTurnedOn } from '../src/frameLoop.js';
import type { MediaAdapter } from '../src/media/mediaAdapter.js';
import { MediaBridge } from '../src/media/mediaBridge.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';
import { NullMedia } from './nullMedia.js';

/**
 * 对端关了摄像头再开：**等新画面真的上屏**再抛 firstVideoFrame（2026-09-11 web bob 看 iOS carol）。
 *
 * 关摄像头走 `room.track_muted`，轨道不摘、`<video>` 整通复用，元素上定格着关之前的最后一帧。
 * 原先的首帧判据按轨道只抛一次，mute 再 unmute 不会再抛——uikit 只能按
 * `userVideoAvailable(true)` 立刻揭示，露出来的就是那张旧画面。Android 同一件事见 `IMFirstFrameGate`。
 */

type Frame = { receiveTime?: number; mediaTime?: number };

/** FakeVideo 模拟 `<video>`：记下 requestVideoFrameCallback，`present()` 模拟一帧交给合成器。 */
class FakeVideo {
  srcObject: MediaProvider | null = null;
  private callbacks: ((now: number, frame?: Frame) => void)[] = [];
  requestVideoFrameCallback(callback: (now: number, frame?: Frame) => void): number {
    this.callbacks.push(callback);
    return this.callbacks.length;
  }
  get waiting(): number {
    return this.callbacks.length;
  }
  /** 不给 frame = 浏览器不带元数据；回调里续约的登记留到下一次 present。 */
  present(frame?: Frame): void {
    for (const callback of this.callbacks.splice(0)) callback(performance.now(), frame);
  }
}

/** Node 里没有 MediaStream，用最小替身。 */
class FakeStream {
  private tracks: MediaStreamTrack[] = [];
  addTrack(t: MediaStreamTrack): void {
    this.tracks.push(t);
  }
  removeTrack(t: MediaStreamTrack): void {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
  getTracks(): MediaStreamTrack[] {
    return this.tracks;
  }
}

beforeAll(() => {
  (globalThis as { MediaStream?: unknown }).MediaStream = FakeStream;
});

const quietAdapter = (): MediaAdapter => ({ open: () => {}, close: () => {} }) as unknown as MediaAdapter;

/** bridgeWithCarol 造一个 carol 已经有视频轨（开过又关掉、轨道还在）的 bridge。 */
function bridgeWithCarol(): MediaBridge {
  const bridge = new MediaBridge(quietAdapter());
  const track = { id: 't-cam', kind: 'video', muted: false } as MediaStreamTrack;
  bridge.addRemoteTrack('t-cam', track, 'carol', () => undefined);
  return bridge;
}

describe('MediaBridge.awaitFirstVideoFrame', () => {
  it('开摄像头之后不立刻回调，下一帧上屏才回调一次、带他的视频轨', () => {
    const bridge = bridgeWithCarol();
    const el = new FakeVideo();
    bridge.attachView('carol', el);
    const fired: string[] = [];

    bridge.awaitFirstVideoFrame('carol', (trackId) => fired.push(trackId));
    expect(fired, '元素上还是关之前那帧，不该揭示').toEqual([]);

    el.present();
    expect(fired).toEqual(['t-cam']);
    bridge.attachView('carol', el);
    el.present();
    expect(fired, '一次开摄像头只回调一次').toEqual(['t-cam']);
  });

  it('开的时候格子还没挂上（React 还没提交）：挂上之后在新元素上接着等', () => {
    const bridge = bridgeWithCarol();
    const fired: string[] = [];
    bridge.awaitFirstVideoFrame('carol', (trackId) => fired.push(trackId));

    const el = new FakeVideo();
    bridge.attachView('carol', el);
    expect(fired).toEqual([]);
    el.present();
    expect(fired).toEqual(['t-cam']);
  });

  it('浏览器报不了帧上屏（没有 requestVideoFrameCallback）：立刻放行，退回原来的行为', () => {
    const bridge = bridgeWithCarol();
    bridge.attachView('carol', { srcObject: null });
    const fired: string[] = [];

    bridge.awaitFirstVideoFrame('carol', (trackId) => fired.push(trackId));
    expect(fired).toEqual(['t-cam']);
  });

  it('同一个人又开了一次：只认最新这一轮，上一轮的回调过期不作数', () => {
    const bridge = bridgeWithCarol();
    const el = new FakeVideo();
    bridge.attachView('carol', el);
    const fired: string[] = [];

    bridge.awaitFirstVideoFrame('carol', () => fired.push('first'));
    bridge.awaitFirstVideoFrame('carol', () => fired.push('second'));
    el.present();
    expect(fired).toEqual(['second']);
  });

  it('关摄像头时积压的旧帧一可见就补上屏：收到时刻早于开摄像头的不算，等下一张（20:49 实测）', () => {
    const bridge = bridgeWithCarol();
    const el = new FakeVideo();
    bridge.attachView('carol', el);
    const fired: string[] = [];
    const turnedOffAt = performance.now() - 800;

    bridge.awaitFirstVideoFrame('carol', (trackId) => fired.push(trackId));
    el.present({ receiveTime: turnedOffAt, mediaTime: 1 });
    expect(fired, '补上屏的是关之前那张').toEqual([]);
    expect(el.waiting, '跳过之后接着等下一帧').toBe(1);

    el.present({ receiveTime: performance.now(), mediaTime: 2 });
    expect(fired).toEqual(['t-cam']);
  });

  it('浏览器不带 receiveTime：跳过第一张，mediaTime 变了才算', () => {
    const bridge = bridgeWithCarol();
    const el = new FakeVideo();
    bridge.attachView('carol', el);
    const fired: string[] = [];

    bridge.awaitFirstVideoFrame('carol', (trackId) => fired.push(trackId));
    el.present({ mediaTime: 5 });
    el.present({ mediaTime: 5 });
    expect(fired, '同一张画面反复上屏不算新帧').toEqual([]);
    el.present({ mediaTime: 6 });
    expect(fired).toEqual(['t-cam']);
  });

  it('等的时候同一个元素又挂了一次：不重复登记', () => {
    const bridge = bridgeWithCarol();
    const el = new FakeVideo();
    bridge.attachView('carol', el);
    bridge.awaitFirstVideoFrame('carol', () => undefined);

    bridge.attachView('carol', el);
    expect(el.waiting).toBe(1);
  });

  it('一轮房间结束（reset）就忘掉全部等待', () => {
    const bridge = bridgeWithCarol();
    const el = new FakeVideo();
    bridge.attachView('carol', el);
    const fired: string[] = [];

    bridge.awaitFirstVideoFrame('carol', (trackId) => fired.push(trackId));
    bridge.reset();
    el.present();
    expect(fired).toEqual([]);
  });
});

describe('videoTurnedOn', () => {
  it('只挑「视频、开」的人：关摄像头与开关麦克风不用等画面', () => {
    expect(videoTurnedOn([
      { cb: 'onUserVideoAvailable', args: { uid: 'carol', available: true } },
      { cb: 'onUserVideoAvailable', args: { uid: 'bob', available: false } },
      { cb: 'onUserAudioAvailable', args: { uid: 'dave', available: true } },
      { cb: 'onUserVideoAvailable', args: { uid: '', available: true } },
      { cb: 'onUserEnter', args: { uid: 'erin' } },
    ])).toEqual(['carol']);
  });
});

describe('engine：对端开摄像头要等新画面上屏才抛 firstVideoFrame', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  async function joinedEngine(): Promise<{ engine: CallEngine; socket: () => FakeWebSocket }> {
    const sockets: FakeWebSocket[] = [];
    const engine = new CallEngine({
      url: 'ws://test/v1/ws',
      deviceId: 'd1',
      media: new NullMedia(),
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.open());
        return socket;
      },
    });
    const socket = (): FakeWebSocket => sockets.at(-1) as FakeWebSocket;

    const login = engine.login('token');
    await flush(6);
    socket().receive(JSON.stringify({
      type: 'sys.hello.ok', req_id: socket().lastFrame()?.req_id ?? '', ts: 1,
      data: {
        uid: 'bob', device_id: 'd1', session_id: 's-1', server_time_ms: 1, resumed: false, ping_interval_sec: 15,
        limits: {
          max_frame_bytes: 65536, max_callees: 8, max_room_participants: 9,
          max_user_data_bytes: 4096, ring_timeout_sec_default: 30,
        },
      },
    }));
    await login;

    const joining = engine.joinRoom('r-1', 'room-token');
    await flush(4);
    const join = socket().frames().find((f) => f.type === 'room.join');
    socket().receive(JSON.stringify({
      type: 'room.join.ok', req_id: join?.req_id ?? '', ts: 1,
      data: { room_id: 'r-1', participant_id: 'r-1-p1', participants: [], tracks: [] },
    }));
    await joining;
    return { engine, socket };
  }

  function trackMuted(socket: FakeWebSocket, kind: 'audio' | 'video', muted: boolean): void {
    socket.receive(JSON.stringify({
      type: 'room.track_muted', req_id: '', ts: 1,
      data: { room_id: 'r-1', track_id: `t-${kind}`, participant_id: 'r-1-p2', uid: 'carol', kind, muted },
    }));
  }

  it('开摄像头：先抛 userVideoAvailable，新画面上屏才抛 firstVideoFrame；关摄像头和开关麦克风不等', async () => {
    const { engine, socket } = await joinedEngine();
    const el = new FakeVideo();
    engine.attachView('carol', el);
    const order: string[] = [];
    engine.on('userVideoAvailable', (e) => order.push(`video:${String(e.available)}`));
    engine.on('firstVideoFrame', (e) => order.push(`frame:${e.uid}`));

    trackMuted(socket(), 'video', true);
    trackMuted(socket(), 'audio', false);
    await flush(4);
    expect(el.waiting, '关摄像头、开麦克风都不该开始等画面').toBe(0);

    trackMuted(socket(), 'video', false);
    await flush(4);
    expect(order).toEqual(['video:false', 'video:true']);

    el.present();
    expect(order).toEqual(['video:false', 'video:true', 'frame:carol']);
  });
});
