import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallEngine } from '../src/engine.js';
import { NullMedia } from './nullMedia.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';

/**
 * `CallEngine.forceEnd()` 的接线：**结束帧不排在在途请求后面；本地收场只抛一次；
 * 收场之后迟到的应答一个都不能把这一场捡回来。**
 *
 * 复现的是 2026-09-13 14:53 iOS frank 那一刻的形状（iOS `FacadeTests.testForceEndHangsUpWhileJoinIsInFlight`）。
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
    roomJoins: 0,
    roomLefts: 0,
  };
  engine.on('callEnd', (e) => h.callEnds.push({ reason: e.reason }));
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

describe('forceEnd：join 在飞时强制收场', () => {
  it('结束帧立刻上线路、只抛一次 callEnd；迟到的 join.ok 补发 leave，迟到的候选不进媒体层', async () => {
    const h = await setup();
    h.event('call.incoming', {
      call_id: 'c-1', room_id: 'r-1', caller: 'bob', callee_ids: ['alice'],
      media_type: 'video', is_group: true, timeout_sec: 30, invited_at_ms: 1, user_data: '',
    });
    await flush(4);
    const accepting = h.engine.accept();
    await flush(4);
    h.reply('call.accept', 'call.accept.ok');
    await accepting;
    h.event('call.connected', {
      call_id: 'c-1', room_id: 'r-1', room_token: 'rt-1', media_type: 'video',
      is_group: true, connected_at_ms: 1, accepted_by: 'alice',
    });
    await flush(4);
    expect(h.latest().frames().some((f) => f.type === 'room.join')).toBe(true); // 故意不回

    const closesBefore = h.media.closes;
    h.engine.forceEnd();

    // **同步**：调用返回时帧已经写进 socket、callEnd 已经抛了、媒体已经关了。
    const hangup = h.latest().frames().at(-1);
    expect(hangup?.type).toBe('call.hangup');
    expect(hangup?.data['call_id']).toBe('c-1');
    expect(h.callEnds).toEqual([{ reason: 'hangup' }]);
    expect(h.media.closes).toBeGreaterThan(closesBefore);
    expect(h.engine.state.call.state).toBe('idle');

    // 服务端随后的 call.ended 不能再抛一次。
    h.event('call.ended', {
      call_id: 'c-1', room_id: 'r-1', reason: 'hangup', duration_sec: 3, ended_by: 'alice',
    });
    // 服务端已经放他进房了：不认领，退出来。
    h.reply('room.join', 'room.join.ok', {
      room_id: 'r-1', participant_id: 'r-1-p6', participants: [], tracks: [],
    });
    await flush(6);
    const leave = h.latest().frames().at(-1);
    expect(leave?.type).toBe('room.leave');
    expect(leave?.data['room_id']).toBe('r-1');
    h.reply('room.leave', 'room.leave.ok');
    h.event('room.ice_candidate', {
      pc: 'sub', candidate: 'candidate:1 1 udp 1 127.0.0.1 7881 typ host', sdp_mid: '0', sdp_mline_index: 0,
    });
    await flush(6);

    expect(h.callEnds).toHaveLength(1);
    expect(h.roomJoins).toBe(0);
    expect(h.roomLefts).toBe(0); // 补发的 leave 是善后，不是宿主要知道的离房
    expect(h.media.candidates).toBe(0);
  });
});

describe('forceEnd：invite 在飞时强制收场', () => {
  it('本地立刻收场（reason=cancel）；invite.ok 迟到后补发 call.cancel', async () => {
    const h = await setup();
    const calling = h.engine.call(['bob'], 'video', false);
    await flush(4);
    expect(h.latest().frames().some((f) => f.type === 'call.invite')).toBe(true);

    h.engine.forceEnd();
    expect(h.callEnds).toEqual([{ reason: 'cancel' }]);
    expect(h.latest().frames().some((f) => f.type === 'call.cancel')).toBe(false);

    h.reply('call.invite', 'call.invite.ok', { call_id: 'c-9', room_id: 'r-9' });
    await flush(6);
    const cancel = h.latest().frames().at(-1);
    expect(cancel?.type).toBe('call.cancel');
    expect(cancel?.data['call_id']).toBe('c-9');

    h.reply('call.cancel', 'call.cancel.ok');
    await calling;
    expect(h.callEnds).toHaveLength(1);
  });

  it('被叫抢先接了、回来的是 call.connected：补发 call.hangup，不进房', async () => {
    const h = await setup();
    const calling = h.engine.call(['bob'], 'video', false);
    await flush(4);
    h.engine.forceEnd();

    h.event('call.connected', {
      call_id: 'c-9', room_id: 'r-9', room_token: 'rt', media_type: 'video',
      is_group: false, connected_at_ms: 1, accepted_by: 'bob',
    });
    await flush(4);
    const last = h.latest().frames().at(-1);
    expect(last?.type).toBe('call.hangup');
    expect(last?.data['call_id']).toBe('c-9');
    expect(h.latest().frames().some((f) => f.type === 'room.join')).toBe(false);

    h.reply('call.hangup', 'call.hangup.ok');
    h.reply('call.invite', 'call.invite.ok', { call_id: 'c-9', room_id: 'r-9' });
    await flush(6);
    h.reply('call.cancel', 'call.cancel.ok');
    await calling;
    expect(h.callEnds).toHaveLength(1);
  });
});

describe('拨出中还没拿到 call_id 就按取消（10:09 demo-react 真机多收一条 1401）', () => {
  it('invite 未回时 cancel：不发帧、不抛 error；invite.ok 回来立刻补发带 call_id 的 cancel', async () => {
    const h = await setup();
    const errors: number[] = [];
    h.engine.on('error', (e) => errors.push(e.code));
    const calling = h.engine.call(['bob'], 'video', false);
    await flush(4);

    await h.engine.cancel();
    await flush(4);
    expect(h.latest().frames().some((f) => f.type === 'call.cancel')).toBe(false);
    expect(errors).toEqual([]);

    h.reply('call.invite', 'call.invite.ok', { call_id: 'c-9', room_id: 'r-9' });
    await flush(6);
    const cancel = h.latest().frames().at(-1);
    expect(cancel?.type).toBe('call.cancel');
    expect(cancel?.data['call_id']).toBe('c-9');

    h.reply('call.cancel', 'call.cancel.ok');
    h.event('call.ended', { call_id: 'c-9', room_id: 'r-9', reason: 'cancel', duration_sec: 0, ended_by: 'alice' });
    await calling;
    await flush(4);
    expect(h.callEnds).toEqual([{ reason: 'cancel' }]);
    expect(errors).toEqual([]);
  });
});

describe('forceEnd：没有进行中的通话', () => {
  it('什么都不发、什么都不抛', async () => {
    const h = await setup();
    const before = h.latest().frames().length;
    h.engine.forceEnd();
    expect(h.latest().frames()).toHaveLength(before);
    expect(h.callEnds).toEqual([]);
  });
});
