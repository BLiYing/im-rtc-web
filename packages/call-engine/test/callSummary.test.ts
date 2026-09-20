import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallEngine } from '../src/engine.js';
import { NullMedia } from './nullMedia.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';
import type { EngineEvents } from '../src/events.js';

/**
 * `callSummary`（通话记录设计 §4）：紧跟 `callEnd`、每通拿到 call_id 的电话恰好一次，
 * 字段取自**结束前**的通话上下文。
 */

const HELLO_OK_DATA = {
  uid: 'alice', device_id: 'd1', session_id: 's-1', server_time_ms: 1_756_876_800_123,
  resumed: false, ping_interval_sec: 15,
  limits: {
    max_frame_bytes: 65536, max_callees: 8, max_room_participants: 9,
    max_user_data_bytes: 4096, ring_timeout_sec_default: 30,
  },
};

/** CountingMedia 记下 engine 关了几次媒体、交下来几个候选。 */
class CountingMedia extends NullMedia {
  closes = 0;
  candidates = 0;
  override close(): void {
    this.closes += 1;
  }
  override async addRemoteCandidate(): Promise<void> {
    this.candidates += 1;
  }
}

interface Harness {
  engine: CallEngine;
  media: CountingMedia;
  latest: () => FakeWebSocket;
  callEnds: { reason: string }[];
  log: string[];
  summaries: EngineEvents['callSummary'][];
  roomJoins: number;
  roomLefts: number;
  reply: (forType: string, type: string, data?: Record<string, unknown>) => void;
  event: (type: string, data: Record<string, unknown>) => void;
}

async function setup(): Promise<Harness> {
  const sockets: FakeWebSocket[] = [];
  const media = new CountingMedia();
  const engine = new CallEngine({
    url: 'ws://test/v1/ws',
    deviceId: 'd1',
    media,
    webSocketFactory: () => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    },
  });
  const h = {
    engine,
    media,
    latest: (): FakeWebSocket => sockets.at(-1) as FakeWebSocket,
    callEnds: [] as { reason: string }[],
    log: [] as string[],
    summaries: [] as EngineEvents['callSummary'][],
    roomJoins: 0,
    roomLefts: 0,
  };
  engine.on('callEnd', (e) => {
    h.callEnds.push({ reason: e.reason });
    h.log.push('end');
  });
  engine.on('callSummary', (e) => {
    h.summaries.push(e);
    h.log.push('summary');
  });
  engine.on('roomJoined', () => {
    h.roomJoins += 1;
  });
  engine.on('roomLeft', () => {
    h.roomLefts += 1;
  });

  const login = engine.login('token');
  await flush(6);
  const hello = sockets[0]?.lastFrame();
  sockets[0]?.receive(JSON.stringify({
    type: 'sys.hello.ok', req_id: hello?.req_id ?? '', ts: 1, data: HELLO_OK_DATA,
  }));
  await login;

  const reqIdOf = (forType: string): string =>
    h.latest().frames().filter((f) => f.type === forType).at(-1)?.req_id ?? '';
  return Object.assign(h, {
    reply: (forType: string, type: string, data: Record<string, unknown> = {}): void => {
      h.latest().receive(JSON.stringify({ type, req_id: reqIdOf(forType), ts: 1, data }));
    },
    event: (type: string, data: Record<string, unknown>): void => {
      h.latest().receive(JSON.stringify({ type, req_id: '', ts: 1, data }));
    },
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('callSummary', () => {
  it('主叫 1v1 没接通：peer 是被叫，caller 回落自己，只来一条且晚于 callEnd', async () => {
    const h = await setup();
    const calling = h.engine.call(['bob'], 'video');
    await flush(4);
    h.reply('call.invite', 'call.invite.ok', { call_id: 'c-1', room_id: 'r-1' });
    await calling;
    h.event('call.ended', { call_id: 'c-1', room_id: 'r-1', reason: 'no_answer', duration_sec: 0, ended_by: '' });
    h.event('call.ended', { call_id: 'c-1', room_id: 'r-1', reason: 'no_answer', duration_sec: 0, ended_by: '' });
    await flush(4);
    expect(h.log).toEqual(['end', 'summary']);
    expect(h.summaries[0]).toEqual({
      callId: 'c-1', reason: 'no_answer', durationSec: 0, endedBy: '', mediaType: 'video',
      isGroup: false, chatGroupId: '', caller: 'alice', role: 'caller', peer: 'bob', userData: '',
    });
  });

  it('被叫群通话：role 是 callee，peer 为空，时长取服务端值', async () => {
    const h = await setup();
    h.event('call.incoming', {
      call_id: 'c-1', room_id: 'r-1', caller: 'bob', callee_ids: ['alice'],
      media_type: 'audio', is_group: true, chat_group_id: 'g-1', user_data: 'u',
    });
    await flush(4);
    h.event('call.ended', { call_id: 'c-1', room_id: 'r-1', reason: 'hangup', duration_sec: 42, ended_by: 'bob' });
    await flush(4);
    expect(h.summaries).toHaveLength(1);
    expect(h.summaries[0]).toMatchObject({
      role: 'callee', caller: 'bob', peer: '', isGroup: true, chatGroupId: 'g-1',
      userData: 'u', durationSec: 42, endedBy: 'bob',
    });
  });

  it('invite 还没拿到 call_id 就被拒：不产生 summary', async () => {
    const h = await setup();
    const calling = h.engine.call(['bob'], 'audio').catch(() => undefined);
    await flush(4);
    h.reply('call.invite', 'sys.error', { code: 1004, name: 'bad_params', msg: '', for_type: 'call.invite', retryable: false });
    await calling;
    await flush(4);
    expect(h.callEnds.length).toBeGreaterThan(0);
    expect(h.summaries).toEqual([]);
  });
});
