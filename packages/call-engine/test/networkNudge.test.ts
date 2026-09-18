import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchBrowserSignals } from '../src/browserSignals.js';
import { Connection } from '../src/signaling/connection.js';
import { PROBE_MS } from '../src/signaling/networkProbe.js';
import { NUDGE_MIN_GAP_MS } from '../src/signaling/reconnector.js';
import { CloseCode } from '../src/signaling/webSocket.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';

/**
 * 回前台 / 网络变化：不再按退避白等（2026-09-18，与 iOS `NetworkNudgeTests`、Android
 * `NetworkChangeReconnectTest` 对应）。现场：Wi-Fi 重连换了 IP，信令在退避 30 秒那一档空等，
 * 服务端 30 秒恢复窗口先到期，通话被结束。
 */

const HELLO_OK_DATA = {
  uid: 'alice',
  device_id: 'd1',
  session_id: 's-1',
  server_time_ms: 1,
  resumed: false,
  ping_interval_sec: 15,
  limits: { max_frame_bytes: 65536, max_callees: 8, max_room_participants: 9, max_user_data_bytes: 4096, ring_timeout_sec_default: 30 },
};

function setup(): { conn: Connection; sockets: FakeWebSocket[]; disconnects: number[] } {
  const sockets: FakeWebSocket[] = [];
  const disconnects: number[] = [];
  const conn = new Connection({
    url: 'ws://test/v1/ws',
    token: 't',
    deviceId: 'd1',
    requestTimeoutMs: 60_000,
    random: () => 0.5, // 无抖动：退避第一档正好 1 秒
    webSocketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    },
    events: { onDisconnected: (info) => disconnects.push(info.code), onError: () => undefined },
  });
  return { conn, sockets, disconnects };
}

async function connect(conn: Connection, sockets: FakeWebSocket[]): Promise<FakeWebSocket> {
  const pending = conn.connect();
  await flush();
  const socket = sockets.at(-1) as FakeWebSocket;
  const hello = socket.lastFrame();
  socket.receive(JSON.stringify({ type: 'sys.hello.ok', req_id: hello?.req_id, ts: 1, data: HELLO_OK_DATA }));
  await pending;
  return socket;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('回前台 / 网络变化立即重连', () => {
  it('正等着退避：网络一变立刻重连', async () => {
    const { conn, sockets } = setup();
    const first = await connect(conn, sockets);
    first.closeFromServer(CloseCode.goingAway); // 排上 1 秒后的重连

    conn.notifyNetworkChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets.length).toBe(2);
  });

  it('正等着退避：回前台同样立刻重连；进后台什么都不做', async () => {
    const { conn, sockets } = setup();
    const first = await connect(conn, sockets);
    first.closeFromServer(CloseCode.goingAway);

    conn.setAppForeground(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets.length).toBe(1);
    conn.setAppForeground(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets.length).toBe(2);
  });

  it('连着：探一下，有回音就什么都不动', async () => {
    const { conn, sockets, disconnects } = setup();
    const ws = await connect(conn, sockets);

    conn.setAppForeground(true);
    const ping = ws.lastFrame();
    expect(ping?.type).toBe('sys.ping');
    ws.receive(JSON.stringify({ type: 'sys.pong', req_id: ping?.req_id, ts: 1, data: {} }));
    await vi.advanceTimersByTimeAsync(PROBE_MS);

    expect(ws.closedWith).toBeNull();
    expect(disconnects).toEqual([]);
    expect(conn.currentState).toBe('connected');
  });

  it('连着：3 秒没回音就判死，当场重连不走退避', async () => {
    const { conn, sockets, disconnects } = setup();
    const ws = await connect(conn, sockets);

    conn.notifyNetworkChanged();
    await vi.advanceTimersByTimeAsync(PROBE_MS - 1);
    expect(ws.closedWith).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(ws.closedWith?.code).toBe(CloseCode.goingAway);
    expect(disconnects).toEqual([CloseCode.goingAway]);
    await vi.advanceTimersByTimeAsync(1); // setTimeout(0) 在计时器里按 1ms 算
    expect(sockets.length).toBe(2);
  });

  it('正在连：这次失败后立刻再连，不走退避', async () => {
    const { conn, sockets } = setup();
    const first = await connect(conn, sockets);
    first.closeFromServer(CloseCode.goingAway);
    await vi.advanceTimersByTimeAsync(1_000); // 退避 1 秒后正在握手
    expect(sockets.length).toBe(2);

    conn.notifyNetworkChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets.length).toBe(2); // 让这次跑完，不另开

    (sockets[1] as FakeWebSocket).closeFromServer(CloseCode.goingAway); // 没连上；下一档本该是 2 秒
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets.length).toBe(3);
  });

  it('网络来回跳：两次立刻重连之间至少隔 2 秒', async () => {
    const { conn, sockets } = setup();
    const first = await connect(conn, sockets);
    first.closeFromServer(CloseCode.goingAway);
    conn.notifyNetworkChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets.length).toBe(2);

    (sockets[1] as FakeWebSocket).closeFromServer(CloseCode.goingAway); // 退避排 1 秒
    conn.notifyNetworkChanged(); // 紧跟着再变一次：补足 2 秒间隔
    await vi.advanceTimersByTimeAsync(NUDGE_MIN_GAP_MS - 1);
    expect(sockets.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets.length).toBe(3);
  });

  it('没登录或已登出：什么都不做', async () => {
    const { conn, sockets } = setup();
    conn.notifyNetworkChanged();
    conn.setAppForeground(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets.length).toBe(0);

    const ws = await connect(conn, sockets);
    conn.close();
    const sent = ws.sent.length;
    conn.notifyNetworkChanged();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets.length).toBe(1);
    expect(ws.sent.length).toBe(sent);
  });
});

describe('浏览器事件 → 信号', () => {
  it('visibilitychange / online / connection.change 各转成一条信号，摘除后不再转', () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
    const win = new EventTarget();
    const connection = new EventTarget();
    const seen: string[] = [];
    const unwatch = watchBrowserSignals(
      {
        setAppForeground: (fg) => seen.push(fg ? 'fg' : 'bg'),
        notifyNetworkChanged: () => seen.push('net'),
      },
      { document: doc, window: win, connection },
    );

    doc.dispatchEvent(new Event('visibilitychange'));
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    win.dispatchEvent(new Event('online'));
    win.dispatchEvent(new Event('offline'));
    connection.dispatchEvent(new Event('change'));
    expect(seen).toEqual(['bg', 'fg', 'net', 'net']);

    unwatch();
    win.dispatchEvent(new Event('online'));
    expect(seen).toHaveLength(4);
  });

  it('不在浏览器里：什么都不挂也不抛', () => {
    const unwatch = watchBrowserSignals(
      { setAppForeground: () => undefined, notifyNetworkChanged: () => undefined },
      {},
    );
    expect(() => unwatch()).not.toThrow();
  });
});
