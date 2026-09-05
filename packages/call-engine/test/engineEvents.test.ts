import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallEngine } from '../src/engine.js';
import type { LocalTrackInfo, MediaAdapter, MediaAdapterEvents } from '../src/media/mediaAdapter.js';
import { CloseCode } from '../src/signaling/webSocket.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';

/**
 * 门面往宿主抛的**事件流本身**要对。
 *
 * 这一组守的是从实测日志里看出来的一类毛病：**同一件事被抛了两遍**，
 * 而且其中一遍的载荷是错的。宿主要靠这些事件记账（数重连、判要不要回登录页），
 * 抛重了它就数不对，而单测状态机是看不出来的——那一层压根不认识关闭码。
 */

const HELLO_OK_DATA = {
  uid: 'alice', device_id: 'd1', session_id: 's-1', server_time_ms: 1756876800123,
  resumed: false, ping_interval_sec: 15,
  limits: {
    max_frame_bytes: 65536, max_callees: 8, max_room_participants: 9,
    max_user_data_bytes: 4096, ring_timeout_sec_default: 30,
  },
};

/** NullMedia 是不做任何事的媒体层——这一组只看事件，不碰媒体。 */
class NullMedia implements MediaAdapter {
  open(_events: MediaAdapterEvents): void {}
  async acquireMicrophone(): Promise<LocalTrackInfo> {
    return { cid: 'mic-1', kind: 'audio', source: 'microphone' };
  }
  async startLocalPreview(): Promise<LocalTrackInfo> {
    return this.acquireCamera();
  }

  async acquireCamera(): Promise<LocalTrackInfo> {
    return { cid: 'cam-1', kind: 'video', source: 'camera' };
  }
  async createPubOffer(): Promise<string> {
    return 'offer-sdp';
  }
  async applyPubAnswer(): Promise<void> {}
  async answerSubOffer(): Promise<string> {
    return 'answer-sdp';
  }
  async addRemoteCandidate(): Promise<void> {}
  setMuted(): void {}
  localTrack(): MediaStreamTrack | undefined {
    return undefined;
  }
  close(): void {}
}

interface Harness {
  engine: CallEngine;
  sockets: FakeWebSocket[];
  latest: () => FakeWebSocket;
  disconnects: { code?: number; willReconnect: boolean }[];
  kicked: number;
}

async function setup(): Promise<Harness> {
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

  const disconnects: { code?: number; willReconnect: boolean }[] = [];
  let kicked = 0;
  engine.on('disconnected', (e) => disconnects.push(e));
  engine.on('kickedOut', () => (kicked += 1));

  const login = engine.login('token');
  await flush(6);
  const hello = sockets[0]?.lastFrame();
  sockets[0]?.receive(JSON.stringify({
    type: 'sys.hello.ok', req_id: hello?.req_id ?? '', ts: 1, data: HELLO_OK_DATA,
  }));
  await login;

  const h: Harness = {
    engine,
    sockets,
    latest: () => sockets.at(-1) as FakeWebSocket,
    disconnects,
    kicked: 0,
  };
  // kicked 是闭包里的计数，用取值器暴露出来。
  Object.defineProperty(h, 'kicked', { get: () => kicked });
  return h;
}

/** 退避档是真实的秒级等待，**一律用假计时器推**，别让套件为它变慢。 */
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('重连也要走完整条链路', () => {
  it('自动重连成功后要再抛一次 connected——不然宿主永远停在「重连中」', async () => {
    const h = await setup();
    const connects: boolean[] = [];
    h.engine.on('connected', (e) => connects.push(e.resumed));

    h.latest().closeFromServer(CloseCode.goingAway, 'restart');
    await flush(4);
    await vi.advanceTimersByTimeAsync(1_400);
    await flush(6);

    // 重连的那次握手由连接层发起，门面必须接住它的结果。
    const hello = h.latest().lastFrame();
    h.latest().receive(JSON.stringify({
      type: 'sys.hello.ok', req_id: hello?.req_id ?? '', ts: 1,
      data: { ...HELLO_OK_DATA, session_id: 's-2', resumed: true },
    }));
    await flush(8);

    expect(connects).toEqual([true]);
  });

  it('重连回来发现会话没了（resumed=false），房间必须归零', async () => {
    const h = await setup();

    // 先真的进一个房间，否则这条断言什么都没验到（初始状态本来就是 idle）。
    const joining = h.engine.joinRoom('r-1', 'room-token');
    await flush(4);
    const join = h.latest().frames().find((f) => f.type === 'room.join');
    h.latest().receive(JSON.stringify({
      type: 'room.join.ok', req_id: join?.req_id ?? '', ts: 1,
      data: { room_id: 'r-1', participant_id: 'r-1-p1', participants: [], tracks: [] },
    }));
    await joining;
    expect(h.engine.state.room.state).toBe('joined');

    h.latest().closeFromServer(CloseCode.goingAway);
    await flush(4);
    await vi.advanceTimersByTimeAsync(1_400);
    await flush(6);

    const hello = h.latest().lastFrame();
    h.latest().receive(JSON.stringify({
      type: 'sys.hello.ok', req_id: hello?.req_id ?? '', ts: 1,
      data: { ...HELLO_OK_DATA, session_id: 's-2', resumed: false },
    }));
    await flush(8);

    // resumed=false 说明服务端那边已经忘了我们；装作还在只会让 UI 撒谎，
    // 而且之后每一帧都会发向一个已经不存在的房间。
    expect(h.engine.state.room.state).toBe('idle');
    expect(h.engine.state.room.roomId).toBe('');
  });
});

describe('disconnected 只抛一次，且带得上关闭码', () => {
  it('一次断线一条事件——状态机那份空载荷的不往外发', async () => {
    const h = await setup();

    h.latest().closeFromServer(CloseCode.goingAway, 'restart');
    await flush(4);

    expect(h.disconnects).toHaveLength(1);
    expect(h.disconnects[0]).toEqual({ code: CloseCode.goingAway, willReconnect: true });
  });

  it('被踢时是 kickedOut + 一条 4403，没有多余的空事件', async () => {
    const h = await setup();

    h.latest().closeFromServer(CloseCode.kickedOut, 'elsewhere');
    await flush(4);

    expect(h.kicked).toBe(1);
    expect(h.disconnects).toHaveLength(1);
    expect(h.disconnects[0]).toEqual({ code: CloseCode.kickedOut, willReconnect: false });
  });

  it('鉴权连续失败到顶时报的是真关闭码 4401，不是复用来的 4403', async () => {
    const h = await setup();

    // 前两次还会重连；第三次到顶（连接层的上限），此时抛 kickedOut。
    for (const step of [1_000, 2_000]) {
      h.latest().closeFromServer(CloseCode.unauthorized);
      await flush(4);
      await vi.advanceTimersByTimeAsync(step + 400);
      await flush(4);
    }
    h.latest().closeFromServer(CloseCode.unauthorized);
    await flush(4);

    expect(h.kicked).toBe(1);
    const last = h.disconnects.at(-1);
    expect(last).toEqual({ code: CloseCode.unauthorized, willReconnect: false });
    // 每次断线各一条，一条不多。
    expect(h.disconnects).toHaveLength(3);
  });
});
