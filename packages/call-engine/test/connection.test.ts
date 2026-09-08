import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorCode, isRtcError } from '../src/errors.js';
import { Connection } from '../src/signaling/connection.js';
import type { HelloOk, KickedOutReason } from '../src/signaling/connection.js';
import { CALL_ID_FIELDS } from '../src/signaling/frames.call.js';
import { SDP_FIELDS } from '../src/signaling/frames.room.js';
import { EMPTY_FIELDS } from '../src/signaling/frames.sys.js';
import { CloseCode } from '../src/signaling/webSocket.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';

/** 这些是**时序测试**：握手、心跳、重连全靠假连接 + 假计时器看清楚。 */

const HELLO_OK_DATA = {
  uid: 'alice',
  device_id: 'd1',
  session_id: 's-1',
  server_time_ms: 1756876800123,
  resumed: false,
  ping_interval_sec: 15,
  limits: {
    max_frame_bytes: 65536,
    max_callees: 8,
    max_room_participants: 9,
    max_user_data_bytes: 4096,
    ring_timeout_sec_default: 30,
  },
};

interface Harness {
  conn: Connection;
  sockets: FakeWebSocket[];
  latest: () => FakeWebSocket;
  events: {
    kicked: number;
    reasons: KickedOutReason[];
    disconnects: { code: number; willReconnect: boolean }[];
    errors: number;
  };
  received: { type: string; data: Record<string, unknown> }[];
}

function setup(): Harness {
  const sockets: FakeWebSocket[] = [];
  const events = {
    kicked: 0,
    reasons: [] as KickedOutReason[],
    disconnects: [] as { code: number; willReconnect: boolean }[],
    errors: 0,
  };
  const received: { type: string; data: Record<string, unknown> }[] = [];

  const conn = new Connection({
    url: 'ws://test/v1/ws',
    token: 'test-token',
    deviceId: 'd1',
    requestTimeoutMs: 1_000,
    // 抖动固定成 0，让退避档位可断言。
    random: () => 0.5,
    webSocketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    },
    events: {
      onKickedOut: (info) => {
        events.kicked += 1;
        events.reasons.push(info.reason);
      },
      onDisconnected: (info) => events.disconnects.push({ code: info.code, willReconnect: info.willReconnect }),
      onError: () => (events.errors += 1),
      onEvent: (type, data) => received.push({ type, data }),
    },
  });

  return { conn, sockets, latest: () => sockets.at(-1) as FakeWebSocket, events, received };
}

/** connect 走完一次握手。 */
async function connect(h: Harness): Promise<HelloOk> {
  const pending = h.conn.connect();
  await flush();
  const socket = h.latest();
  const hello = socket.lastFrame();
  expect(hello?.type).toBe('sys.hello');
  socket.receive(
    JSON.stringify({ type: 'sys.hello.ok', req_id: hello?.req_id, ts: 1, data: HELLO_OK_DATA }),
  );
  return pending;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('握手', () => {
  it('首帧是 sys.hello，带 token / device_id', async () => {
    const h = setup();
    const pending = h.conn.connect();
    await flush();

    const hello = h.latest().lastFrame();
    expect(hello?.type).toBe('sys.hello');
    expect(hello?.data['token']).toBe('test-token');
    expect(hello?.data['device_id']).toBe('d1');
    expect(hello?.data['protocol_version']).toBe(1);
    expect(hello?.data['session_id']).toBe(''); // 首次连接没有会话可恢复

    h.latest().receive(
      JSON.stringify({ type: 'sys.hello.ok', req_id: hello?.req_id, ts: 1, data: HELLO_OK_DATA }),
    );
    const ok = await pending;
    expect(ok.uid).toBe('alice');
    expect(ok.sessionId).toBe('s-1');
    expect(ok.limits.maxRoomParticipants).toBe(9);
    expect(h.conn.currentState).toBe('connected');
  });

  it('重连时带上 session_id 请求恢复', async () => {
    const h = setup();
    await connect(h);

    h.latest().closeFromServer(CloseCode.goingAway, 'restart');
    await flush();
    // 第一档退避是 1s（抖动固定为 0）。
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    const hello = h.latest().lastFrame();
    expect(hello?.type).toBe('sys.hello');
    expect(hello?.data['session_id']).toBe('s-1');
  });
});

/** helloErr 让当前 socket 用一个 sys.error 回掉在途的握手。 */
function helloErr(h: Harness, code: number, name: string, retryable: boolean): void {
  const hello = h.latest().lastFrame();
  h.latest().receive(
    JSON.stringify({
      type: 'sys.error',
      req_id: hello?.req_id,
      ts: 1,
      data: { code, name, msg: name, for_type: 'sys.hello', retryable },
    }),
  );
}

/**
 * reconnectThenFailHello 先连上，再让服务端断开，然后把**重连那次**的握手用错误回掉。
 *
 * 必须走重连路径：首次 `connect()` 失败只是把错误抛给宿主，重连器压根没参与，
 * 在那里数 socket 恒等于 1，测不出「会不会无限重连」。
 */
async function reconnectThenFailHello(
  h: Harness,
  code: number,
  name: string,
  retryable: boolean,
): Promise<void> {
  await connect(h);
  h.latest().closeFromServer(CloseCode.goingAway, 'restart');
  await flush();
  await vi.advanceTimersByTimeAsync(1_000); // 第一档退避（抖动固定为 0）
  await flush();
  expect(h.sockets).toHaveLength(2);
  helloErr(h, code, name, retryable);
  // 真实服务端拒了握手就会关连接——**这一步不能省**：不关的话没有任何东西会去排
  // 下一次重连，「不再重连」那条断言就成了永远为真的空断言（iOS 侧注入 bug 时验过）。
  h.latest().closeFromServer(CloseCode.goingAway, 'rejected');
  await flush();
}

/**
 * 握手被拒之后不该再重连——这是 Pixel 2 XL 那个 bug 的通用形状。
 *
 * `Build.MODEL` 里带空格 → device_id 不合规 → 服务端回 1004。参数不会因为重连而
 * 改变，可当时四端都在无限重连：界面只写「登录失败」，日志刷满同一条错误，
 * 真正的原因被埋在里面。
 */
describe('握手被拒（retryable=false）一次就放弃', () => {
  const cases: [string, number, string][] = [
    ['device_id 不合规', ErrorCode.badParams, 'bad_params'],
    ['协议版本不受支持', ErrorCode.protocolVersionUnsupported, 'protocol_version_unsupported'],
    ['应用被停用', ErrorCode.appDisabled, 'app_disabled'],
  ];

  it.each(cases)('%s：重连时被拒就彻底停手', async (_name, code, wireName) => {
    const h = setup();
    await reconnectThenFailHello(h, code, wireName, false);

    expect(h.events.reasons).toEqual(['configRejected']);
    // 退避档最长也就几十秒；再等 30s 不该出现第三个 socket。
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(h.sockets).toHaveLength(2);
  });

  it('可重试的握手错误照常重连 —— 别把 1102 也一起停了', async () => {
    const h = setup();
    await reconnectThenFailHello(h, ErrorCode.tokenExpired, 'token_expired', true);

    expect(h.events.reasons).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(h.sockets.length).toBeGreaterThan(2);
  });

  it('握手超时不算被拒 —— 那是网络，重连正是它该有的处置', async () => {
    const h = setup();
    await connect(h);
    h.latest().closeFromServer(CloseCode.goingAway, 'restart');
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    // 重连那次的握手一直没人应答，走请求超时（2004，retryable）。
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(h.events.reasons).toEqual([]);
    expect(h.sockets.length).toBeGreaterThan(2);
  });

  /**
   * 三类分流：**不可重试 ≠ 参数不对**，三者的处置完全不同。
   *
   * 合成一类就是给宿主一条错的建议：1101 明明换一枚票就能好，报成 configRejected
   * 会让宿主去翻配置；1104 是被顶下线，该回登录页而不是改参数。
   */
  it.each([
    [ErrorCode.tokenInvalid, 'token_invalid', 'authExpired'],
    [ErrorCode.kickedOut, 'kicked_out', 'takenOver'],
    [ErrorCode.badParams, 'bad_params', 'configRejected'],
  ] as [number, string, KickedOutReason][])(
    '%s 该抛对应的原因，不是一律 configRejected',
    async (code, wireName, want) => {
      const h = setup();
      await reconnectThenFailHello(h, code, wireName, false);

      expect(h.events.reasons).toEqual([want]);
    },
  );

  /**
   * 本端不认识的终局码，要信帧上自带的 `retryable`。
   *
   * 未知码在 `RtcError` 里会被折成 internal（1501，而它 `retryable === true`），
   * 只看折算结果的话**服务端每加一个新的终局码，客户端就多一种无限重连**——
   * 1106 在四端漏过一次，症状正是这个。
   */
  it('未知的终局码：按帧上的 retryable 放弃，不许退回无限重连', async () => {
    const h = setup();
    await reconnectThenFailHello(h, 9999, 'brand_new_final_code', false);

    expect(h.events.reasons).toEqual(['configRejected']);
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(h.sockets).toHaveLength(2);
  });

  /** 未知码而帧上说可重试：照常退避重连，别把服务端新加的临时故障当成终局。 */
  it('未知的可重试码：照常重连，也不该把宿主踢下线', async () => {
    const h = setup();
    await reconnectThenFailHello(h, 9999, 'brand_new_transient_code', true);

    expect(h.events.reasons).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(h.sockets.length).toBeGreaterThan(2);
  });

  /**
   * 宿主自己 logout 不是「服务端拒了你的参数」。
   *
   * `close()` 会拿 `2005 invalid_state`（它 `retryable === false`）把在飞的握手结掉。
   * 只看 `retryable` 的话，一次正常的 logout 会抛 configRejected；而静默续期正是
   * 先 logout 再换票——那就成了「续期把人踹回登录页」。
   */
  it('握手在飞时宿主 logout：不该报成服务端拒绝', async () => {
    const h = setup();
    await connect(h);
    h.latest().closeFromServer(CloseCode.goingAway, 'restart');
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(h.sockets).toHaveLength(2);

    // 重连那次的握手已经发出去、还没有应答，此刻宿主按下 logout。
    h.conn.close();
    await flush();

    expect(h.events.reasons).toEqual([]);
  });

  it('首次登录被拒：错误抛给宿主，同时告诉它「去改配置」', async () => {
    const h = setup();
    const pending = h.conn.connect();
    await flush();
    helloErr(h, ErrorCode.badParams, 'bad_params', false);

    await expect(pending).rejects.toSatisfy(
      (err: unknown) => isRtcError(err) && err.code === ErrorCode.badParams,
    );
    expect(h.events.reasons).toEqual(['configRejected']);
  });
});

describe('请求应答按 req_id 配对', () => {
  it('pub 的 room.offer 由 room.answer 应答 —— 只看类型会对不上号', async () => {
    const h = setup();
    await connect(h);

    const pending = h.conn.request('room.offer', SDP_FIELDS, { pc: 'pub', sdp: 'v=0...' });
    await flush();
    const offer = h.latest().lastFrame();
    expect(offer?.type).toBe('room.offer');

    h.latest().receive(
      JSON.stringify({
        type: 'room.answer',
        req_id: offer?.req_id,
        ts: 1,
        data: { pc: 'pub', sdp: 'v=0 answer' },
      }),
    );
    const result = await pending;
    expect(result.envelope.type).toBe('room.answer');
    expect(result.data['sdp']).toBe('v=0 answer');
  });

  it('sys.error 让对应的请求失败，且带上错误码', async () => {
    const h = setup();
    await connect(h);

    const pending = h.conn.request('call.hangup', CALL_ID_FIELDS, { callId: 'call-1' });
    await flush();
    const sent = h.latest().lastFrame();

    h.latest().receive(
      JSON.stringify({
        type: 'sys.error',
        req_id: sent?.req_id,
        ts: 1,
        data: {
          code: ErrorCode.callNotFound,
          name: 'call_not_found',
          msg: 'call not found',
          for_type: 'call.hangup',
          retryable: false,
        },
      }),
    );

    await expect(pending).rejects.toSatisfy(
      (err: unknown) => isRtcError(err) && err.code === ErrorCode.callNotFound,
    );
  });

  it('超时抛 signaling_timeout', async () => {
    const h = setup();
    await connect(h);

    const pending = h.conn.request('sys.ping', EMPTY_FIELDS, {});
    const assertion = expect(pending).rejects.toSatisfy(
      (err: unknown) => isRtcError(err) && err.code === ErrorCode.signalingTimeout,
    );
    await vi.advanceTimersByTimeAsync(1_100);
    await assertion;
  });
});

describe('事件', () => {
  it('req_id 为空的帧走 onEvent', async () => {
    const h = setup();
    await connect(h);

    h.latest().receive(
      JSON.stringify({
        type: 'call.incoming',
        req_id: '',
        ts: 1,
        data: {
          call_id: 'call-1',
          room_id: 'r-1',
          caller: 'bob',
          callee_ids: ['alice'],
          media_type: 'video',
          is_group: false,
        },
      }),
    );
    expect(h.received).toHaveLength(1);
    expect(h.received[0]?.type).toBe('call.incoming');
    expect(h.received[0]?.data['caller']).toBe('bob');
  });

  it('未知帧类型静默忽略 —— 服务端可能比我们新（§2.3）', async () => {
    const h = setup();
    await connect(h);
    h.latest().receive(JSON.stringify({ type: 'room.brand_new', req_id: '', ts: 1, data: {} }));
    expect(h.received).toHaveLength(0);
    expect(h.events.errors).toBe(0);
  });
});

describe('心跳', () => {
  it('按服务端下发的间隔发 ping', async () => {
    const h = setup();
    await connect(h);
    const before = h.latest().sent.length;

    await vi.advanceTimersByTimeAsync(15_000);
    const frames = h.latest().frames().slice(before);
    expect(frames.map((f) => f.type)).toEqual(['sys.ping']);
  });

  it('连续 3 个周期没收到任何帧就判死', async () => {
    const h = setup();
    await connect(h);

    await vi.advanceTimersByTimeAsync(15_000 * 4);
    expect(h.sockets[0]?.closedWith?.code).toBe(CloseCode.goingAway);
  });

  it('收到任何帧都算活着 —— 不只是 pong', async () => {
    const h = setup();
    await connect(h);
    const socket = h.latest();

    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(15_000);
      // 用一个业务事件而不是 pong 来续命。
      socket.receive(
        JSON.stringify({ type: 'room.quality', req_id: '', ts: 1, data: { room_id: 'r-1', entries: [] } }),
      );
    }
    expect(socket.closedWith).toBeNull();
  });
});

describe('关闭码决定要不要重连', () => {
  it.each([
    ['对端发来的 1000 要重连（浏览器掐后台标签页用的就是这个码）', CloseCode.normal, true],
    ['服务端重启 1001 重连', CloseCode.goingAway, true],
    ['协议错 4400 不重连（是我们自己的 bug）', CloseCode.badProtocol, false],
    ['鉴权失败 4401 重连（换 token 后可能成功）', CloseCode.unauthorized, true],
    ['被踢 4403 不重连（重连等于跟另一台设备打架）', CloseCode.kickedOut, false],
    ['限速 4429 重连', CloseCode.rateLimited, true],
  ])('%s', async (_name, code, willReconnect) => {
    const h = setup();
    await connect(h);
    const socketCount = h.sockets.length;

    h.latest().closeFromServer(code);
    await flush();
    expect(h.events.disconnects.at(-1)).toEqual({ code, willReconnect });

    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(h.sockets.length > socketCount).toBe(willReconnect);
  });

  it('4403 抛 onKickedOut', async () => {
    const h = setup();
    await connect(h);
    h.latest().closeFromServer(CloseCode.kickedOut);
    await flush();
    expect(h.events.kicked).toBe(1);
  });

  it('连续 3 次 4401 就彻底放弃并抛 onKickedOut——重连带的是同一枚废票', async () => {
    const h = setup();
    await connect(h);

    // 前两次还给机会：换新 token 后重连是可能成功的（协议 §1.5）。
    for (const step of [1_000, 2_000]) {
      h.latest().closeFromServer(CloseCode.unauthorized);
      await flush();
      expect(h.events.disconnects.at(-1)?.willReconnect).toBe(true);
      expect(h.events.kicked).toBe(0);
      // 只推进到这一档退避，让重连**恰好发生一次**——多推的话握手超时会再排一次。
      await vi.advanceTimersByTimeAsync(step);
      await flush();
    }

    // 第 3 次到顶：不再重连，把宿主赶回登录页去换票。
    const socketCount = h.sockets.length;
    h.latest().closeFromServer(CloseCode.unauthorized);
    await flush();
    expect(h.events.kicked).toBe(1);
    expect(h.events.disconnects.at(-1)?.willReconnect).toBe(false);

    await vi.advanceTimersByTimeAsync(120_000);
    await flush();
    expect(h.sockets).toHaveLength(socketCount);
  });

  it('握手成功会把鉴权失败计数清零——只有连续失败才说明票是死的', async () => {
    const h = setup();
    await connect(h);

    for (const step of [1_000, 1_000, 1_000, 1_000, 1_000]) {
      h.latest().closeFromServer(CloseCode.unauthorized);
      await flush();
      await vi.advanceTimersByTimeAsync(step);
      await flush();
      // 每次重连都握手成功 → 计数清零，退避档也归零，所以下一档还是 1s。
      const hello = h.latest().lastFrame();
      h.latest().receive(
        JSON.stringify({ type: 'sys.hello.ok', req_id: hello?.req_id, ts: 1, data: HELLO_OK_DATA }),
      );
      await flush();
    }
    expect(h.events.kicked).toBe(0);
  });

  it('一次断线只排一次重连——两条路都会走到 schedule，重排会让退避档翻倍地涨', async () => {
    const h = setup();
    await connect(h);

    h.latest().closeFromServer(CloseCode.goingAway);
    await flush();
    // 第一档退避是 1s（抖动固定为 0）。若档位被多加了一级，这时还不会有新连接。
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(h.sockets).toHaveLength(2);
  });

  it('主动 close 不重连', async () => {
    const h = setup();
    await connect(h);
    const socketCount = h.sockets.length;

    h.conn.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(socketCount);
    expect(h.conn.currentState).toBe('closed');
  });
});
