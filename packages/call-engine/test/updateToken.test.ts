import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallEngine } from '../src/engine.js';
import type { LocalTrackInfo, MediaAdapter, MediaAdapterEvents } from '../src/media/mediaAdapter.js';
import { CloseCode } from '../src/signaling/webSocket.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';

/**
 * `updateToken` 是**宿主实现协议 §1.5 的唯一入口**（`4401` → 换新 token 后重连）。
 *
 * 它一开始整个不存在：`Connection.updateToken` 有，但门面没暴露——
 * 于是协议要求宿主做的那件事，Web 端做不到。这一组守着这个口子。
 */

const HELLO_OK_DATA = {
  uid: 'alice', device_id: 'd1', session_id: 's-1', server_time_ms: 1756876800123,
  resumed: false, ping_interval_sec: 15,
  limits: {
    max_frame_bytes: 65536, max_callees: 8, max_room_participants: 9,
    max_user_data_bytes: 4096, ring_timeout_sec_default: 30,
  },
};

class NullMedia implements MediaAdapter {
  open(_events: MediaAdapterEvents): void {}
  async acquireMicrophone(): Promise<LocalTrackInfo> {
    return { cid: 'mic-1', kind: 'audio', source: 'microphone' };
  }
  async probeMicrophone(): Promise<void> {}
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
  /** 各次握手用的 token，按顺序。 */
  tokensSent: () => string[];
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

  const login = engine.login('token-old');
  await flush(6);
  const hello = sockets[0]?.lastFrame();
  sockets[0]?.receive(JSON.stringify({
    type: 'sys.hello.ok', req_id: hello?.req_id ?? '', ts: 1, data: HELLO_OK_DATA,
  }));
  await login;

  return {
    engine,
    sockets,
    latest: () => sockets.at(-1) as FakeWebSocket,
    tokensSent: () =>
      sockets
        .map((socket) => socket.frames().find((f) => f.type === 'sys.hello')?.data['token'])
        .filter((token): token is string => typeof token === 'string'),
  };
}

/**
 * waitForReconnect 把假计时器推到下一次重连之后。
 *
 * **必须用假计时器**：退避第一档是 1 秒，真等的话这三个用例要跑 5 秒多，
 * 而整个 engine 套件本来是毫秒级的。1500ms 足够盖住任何一档 ±20% 的抖动。
 */
async function waitForReconnect(ms = 1_500): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flush(6);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('updateToken', () => {
  it('下一次重连就用新票——这就是宿主处置 4401 的全部动作', async () => {
    const h = await setup();
    expect(h.tokensSent()).toEqual(['token-old']);

    h.latest().closeFromServer(CloseCode.unauthorized);
    await flush(4);
    // 宿主收到 disconnected(4401) 后去换票，然后交给 engine。
    h.engine.updateToken('token-new');

    await waitForReconnect();
    expect(h.tokensSent()).toEqual(['token-old', 'token-new']);
  });

  it('换票也把鉴权失败计数清零——否则换了新票却已经没有重试机会了', async () => {
    const h = await setup();

    // 先烧掉两次机会（上限 3），全程不换票。
    h.latest().closeFromServer(CloseCode.unauthorized);
    await flush(4);
    await waitForReconnect();
    h.latest().closeFromServer(CloseCode.unauthorized);
    await flush(4);

    // 这时换票：计数归零，engine 还应该继续重连而不是抛 kickedOut。
    let kicked = 0;
    h.engine.on('kickedOut', () => (kicked += 1));
    h.engine.updateToken('token-new');

    await waitForReconnect(2_600);
    h.latest().closeFromServer(CloseCode.unauthorized);
    await flush(4);

    expect(kicked).toBe(0);
    expect(h.tokensSent().at(-1)).toBe('token-new');
  });

  it('连上着的时候换票不动当前连接（提前续票的场景）', async () => {
    const h = await setup();
    const before = h.sockets.length;

    h.engine.updateToken('token-new');
    await flush(4);

    expect(h.sockets).toHaveLength(before);
    expect(h.latest().closedWith).toBeNull();
  });
});
