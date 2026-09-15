import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Connection } from '../src/signaling/connection.js';
import { CALL_ID_FIELDS } from '../src/signaling/frames.call.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';

/**
 * `Connection.fire`：**立刻发、应答配对后丢掉**（`CallEngine.forceEnd` 用）。
 * 应答要是漏进事件流，门面会把 `.ok` 当事件喂给状态机。iOS `SignalingTests` 同义。
 */

const HELLO_OK_DATA = {
  uid: 'alice', device_id: 'd1', session_id: 's-1', server_time_ms: 1_756_876_800_123,
  resumed: false, ping_interval_sec: 15,
  limits: {
    max_frame_bytes: 65536, max_callees: 8, max_room_participants: 9,
    max_user_data_bytes: 4096, ring_timeout_sec_default: 30,
  },
};

function setup(): { conn: Connection; sockets: FakeWebSocket[]; events: string[] } {
  const sockets: FakeWebSocket[] = [];
  const events: string[] = [];
  const conn = new Connection({
    url: 'ws://test/v1/ws',
    token: 'test-token',
    deviceId: 'd1',
    requestTimeoutMs: 1_000,
    random: () => 0.5,
    webSocketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    },
    events: { onEvent: (type) => events.push(type) },
  });
  return { conn, sockets, events };
}

async function handshake(h: ReturnType<typeof setup>): Promise<FakeWebSocket> {
  const connecting = h.conn.connect();
  await flush(6);
  const ws = h.sockets[0] as FakeWebSocket;
  ws.receive(JSON.stringify({
    type: 'sys.hello.ok', req_id: ws.lastFrame()?.req_id ?? '', ts: 1, data: HELLO_OK_DATA,
  }));
  await connecting;
  return ws;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('Connection.fire', () => {
  it('调用返回时帧已经写进 socket，应答不进事件流', async () => {
    const h = setup();
    const ws = await handshake(h);

    h.conn.fire('call.hangup', CALL_ID_FIELDS, { callId: 'c-1' });
    const sent = ws.lastFrame();
    expect(sent?.type).toBe('call.hangup');
    expect(sent?.data['call_id']).toBe('c-1');
    expect(sent?.req_id).not.toBe(''); // 请求帧必须带 req_id，服务端才回得了应答

    ws.receive(JSON.stringify({ type: 'call.hangup.ok', req_id: sent?.req_id ?? '', ts: 1, data: {} }));
    await flush(4);
    expect(h.events).not.toContain('call.hangup.ok');
  });

  it('被拒或超时只记日志，不抛、不进事件流', async () => {
    const h = setup();
    const ws = await handshake(h);
    h.conn.fire('call.hangup', CALL_ID_FIELDS, { callId: 'c-1' });
    const sent = ws.lastFrame();
    ws.receive(JSON.stringify({
      type: 'sys.error', req_id: sent?.req_id ?? '', ts: 1,
      data: { code: 1401, name: 'call_not_found', msg: 'x', for_type: 'call.hangup', retryable: false },
    }));
    await flush(4);
    vi.advanceTimersByTime(1_500);
    await flush(4);
    expect(h.events).toEqual([]);
  });

  it('还没连上时一帧都不发（握手之前发业务帧会被服务端当成协议错误）', async () => {
    const h = setup();
    const connecting = h.conn.connect();
    await flush(6);
    const ws = h.sockets[0] as FakeWebSocket;

    h.conn.fire('call.hangup', CALL_ID_FIELDS, { callId: 'c-1' });
    expect(ws.frames().map((f) => f.type)).toEqual(['sys.hello']);

    ws.receive(JSON.stringify({
      type: 'sys.hello.ok', req_id: ws.lastFrame()?.req_id ?? '', ts: 1, data: HELLO_OK_DATA,
    }));
    await connecting;
    expect(ws.frames().some((f) => f.type === 'call.hangup')).toBe(false);
  });
});
