import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import { CallEngine } from '../src/engine.js';
import type { KickedOutReason } from '../src/signaling/connectionTypes.js';
import { CloseCode } from '../src/signaling/webSocket.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';
import { NullMedia } from './nullMedia.js';

/**
 * 票的生命周期在**门面这一层**对不对。
 *
 * 两件事：
 * 1. `tokenWillExpire` 真的抛到宿主手上（服务端说了到期时刻的话）；
 * 2. `kickedOut` 带着能区分处置的 `reason`——`takenOver` 回登录页、
 *    `authExpired` 换票重来。这两个处置相反，混在一起宿主就只能都当登录失效。
 */

const BASE_HELLO = {
  uid: 'alice', device_id: 'd1', session_id: 's-1', server_time_ms: 1756876800123,
  resumed: false, ping_interval_sec: 15,
  limits: {
    max_frame_bytes: 65536, max_callees: 8, max_room_participants: 9,
    max_user_data_bytes: 4096, ring_timeout_sec_default: 30,
  },
};

interface Harness {
  engine: CallEngine;
  sockets: FakeWebSocket[];
  latest: () => FakeWebSocket;
  kicks: { reason: KickedOutReason }[];
  expiries: { expiresAtMs: number }[];
}

/**
 * answerPings 让假服务端回 `sys.pong`。
 *
 * **不回 pong 的代价不是「少一帧」，是整条用例测的东西全变了**：连续 3 个周期没动静
 * 触发判死 → 关连接 → 重连 → 新握手也没人应答 → 请求超时 → 再重连。
 * 「永不抛」那条要推进 24 小时假时钟，于是它实际跑的是**一场 2159 条连接的重连风暴**
 * （量过），耗时 1.3s~4.2s 全看机器忙不忙，长期贴着 5s 超时线——干净树上三次能红两次。
 *
 * 真实服务端是会回 pong 的。回上之后，那条用例才是它名字说的那件事。
 */
function answerPings(socket: FakeWebSocket): void {
  const send = socket.send.bind(socket);
  socket.send = (data: string): void => {
    send(data);
    const frame = JSON.parse(data) as { type: string; req_id: string };
    if (frame.type !== 'sys.ping') return;
    socket.receive(JSON.stringify({ type: 'sys.pong', req_id: frame.req_id, ts: 1, data: {} }));
  };
}

async function setup(tokenExpiresAtMs: number, pingIntervalSec = 15): Promise<Harness> {
  const sockets: FakeWebSocket[] = [];
  const engine = new CallEngine({
    url: 'wss://example.test/v1/ws',
    deviceId: 'd1',
    media: new NullMedia(),
    webSocketFactory: (): FakeWebSocket => {
      const socket = new FakeWebSocket();
      answerPings(socket);
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    },
  });

  const kicks: { reason: KickedOutReason }[] = [];
  const expiries: { expiresAtMs: number }[] = [];
  engine.on('kickedOut', (e) => kicks.push(e));
  engine.on('tokenWillExpire', (e) => expiries.push(e));

  const login = engine.login('token');
  await flush(6);
  const hello = sockets[0]?.lastFrame();
  sockets[0]?.receive(
    JSON.stringify({
      type: 'sys.hello.ok',
      req_id: hello?.req_id ?? '',
      ts: 1,
      data: {
        ...BASE_HELLO,
        ping_interval_sec: pingIntervalSec,
        token_expires_at_ms: tokenExpiresAtMs,
      },
    }),
  );
  await login;

  return { engine, sockets, latest: () => sockets.at(-1) as FakeWebSocket, kicks, expiries };
}

describe('接入票生命周期', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('到期前 60s 抛 tokenWillExpire，带上到期时刻', async () => {
    const expiresAt = Date.now() + 3_600_000;
    const h = await setup(expiresAt);

    expect(h.expiries).toHaveLength(0); // 还早，不该提前催
    await vi.advanceTimersByTimeAsync(3_600_000 - 60_000 + 100);
    expect(h.expiries).toEqual([{ expiresAtMs: expiresAt }]);

    h.engine.logout();
  });

  /*
    服务端不带到期时刻（老服务端、或 Verifier 不暴露 exp）时必须完全不抛——
    抛一个假的会让宿主按错误的节奏去换票。
  */
  it('服务端说未知（0）时永不抛', async () => {
    // **心跳拉到 1 小时一次**：这一条要推进 24 小时假时钟才能说「永不」，
    // 而默认 15s 意味着 5760 次 ping/pong 往返——那点开销和票期毫无关系，
    // 却占掉这条用例的绝大部分耗时（量过：5760 次 ≈ 2.4s，24 次 ≈ 56ms）。
    // 拉到 3600s 只剩 24 次，断言一个字没改。
    const h = await setup(0, 3_600);
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(h.expiries).toHaveLength(0);

    h.engine.logout();
  });

  it('4403 被踢：reason=takenOver，且只抛一次', async () => {
    const h = await setup(0);

    h.latest().closeFromServer(CloseCode.kickedOut, 'elsewhere');
    await flush(4);

    expect(h.kicks).toEqual([{ reason: 'takenOver' }]);
  });

  /*
    4401 连续三次没换上票，与「被顶号」是完全不同的处置：宿主该去取一枚新票再 login，
    而不是把用户赶回登录页。这就是 reason 存在的全部理由。
  */
  it('4401 用尽：reason=authExpired，与被顶号区分得开', async () => {
    const h = await setup(0);

    for (const step of [1_000, 2_000]) {
      h.latest().closeFromServer(CloseCode.unauthorized);
      await flush(4);
      await vi.advanceTimersByTimeAsync(step + 400);
      await flush(4);
    }
    h.latest().closeFromServer(CloseCode.unauthorized);
    await flush(4);

    expect(h.kicks).toEqual([{ reason: 'authExpired' }]);
  });

  it('updateToken 带上新到期时刻会重新武装定时器', async () => {
    const h = await setup(Date.now() + 3_600_000);

    // 换一张只剩 90s 的票：新的提醒应该在 30s 后（90 - 60）到，
    // 而不是沿用旧票那个一小时后的时刻。
    h.engine.updateToken('fresh-token', Date.now() + 90_000);
    await vi.advanceTimersByTimeAsync(30_000 + 100);

    expect(h.expiries).toHaveLength(1);
    h.engine.logout();
  });

  it('logout 之后定时器不再响', async () => {
    const h = await setup(Date.now() + 3_600_000);
    h.engine.logout();

    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(h.expiries).toHaveLength(0);
  });
});
