import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallEngine } from '../src/engine.js';
import { ErrorCode } from '../src/errors.js';
import { NullMedia } from './nullMedia.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';

/**
 * **调用结果回给调用方**（server `docs/design/ACTION_RESULT_DESIGN.md`，2.0.0）。
 *
 * 每个发起类方法四格：成功 resolve / 本地拒绝 reject 2005 / 服务端拒绝 reject 那个码 / 断线 reject 2003；
 * 每格都断言**没有**多发 `error` 事件（R3：一次失败只从一个出口报）。
 * 连锁帧（R2）、退出类本地收场（D2）、提示与清理类不 reject（D3）各有单独的用例。
 */

const HELLO_OK_DATA = {
  uid: 'alice', device_id: 'd1', session_id: 's-1', server_time_ms: 1_756_876_800_123,
  resumed: false, ping_interval_sec: 15,
  limits: {
    max_frame_bytes: 65536, max_callees: 8, max_room_participants: 9,
    max_user_data_bytes: 4096, ring_timeout_sec_default: 30,
  },
};

interface Harness {
  engine: CallEngine;
  latest: () => FakeWebSocket;
  errors: { code: number; forType: string }[];
  callEnds: string[];
  roomLefts: string[];
  reply: (forType: string, type: string, data?: Record<string, unknown>) => void;
  rejectRequest: (forType: string, code: number) => void;
  event: (type: string, data: Record<string, unknown>) => void;
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
  const latest = (): FakeWebSocket => sockets.at(-1) as FakeWebSocket;
  const reqIdOf = (forType: string): string =>
    latest().frames().filter((f) => f.type === forType).at(-1)?.req_id ?? '';
  const h: Harness = {
    engine,
    latest,
    errors: [],
    callEnds: [],
    roomLefts: [],
    reply: (forType, type, data = {}) => {
      latest().receive(JSON.stringify({ type, req_id: reqIdOf(forType), ts: 1, data }));
    },
    rejectRequest: (forType, code) => {
      latest().receive(JSON.stringify({
        type: 'sys.error', req_id: reqIdOf(forType), ts: 1,
        data: { code, name: 'x', msg: 'x', for_type: forType, retryable: false },
      }));
    },
    event: (type, data) => {
      latest().receive(JSON.stringify({ type, req_id: '', ts: 1, data }));
    },
  };
  engine.on('error', (e) => h.errors.push({ code: e.code, forType: e.forType }));
  engine.on('callEnd', (e) => h.callEnds.push(e.reason));
  engine.on('roomLeft', (e) => h.roomLefts.push(e.roomId));

  const login = engine.login('token');
  await flush(6);
  latest().receive(JSON.stringify({
    type: 'sys.hello.ok', req_id: latest().lastFrame()?.req_id ?? '', ts: 1, data: HELLO_OK_DATA,
  }));
  await login;
  return h;
}

// ── 把 engine 推到某个状态 ─────────────────────────────────────

async function ringing(h: Harness): Promise<void> {
  h.event('call.incoming', {
    call_id: 'c-1', room_id: 'r-1', caller: 'bob', callee_ids: ['alice'],
    media_type: 'audio', is_group: true, timeout_sec: 30, user_data: '',
  });
  await flush(4);
}

async function inviting(h: Harness): Promise<void> {
  const calling = h.engine.call(['bob'], 'audio');
  await flush(4);
  h.reply('call.invite', 'call.invite.ok', { call_id: 'c-1', room_id: 'r-1', room_token: 'rt', timeout_sec: 30 });
  await calling;
  await flush(2);
}

async function inCall(h: Harness): Promise<void> {
  await ringing(h);
  const accepting = h.engine.accept();
  await flush(4);
  h.reply('call.accept', 'call.accept.ok');
  await accepting;
  h.event('call.connected', {
    call_id: 'c-1', room_id: 'r-1', room_token: 'rt-1', media_type: 'audio',
    is_group: true, connected_at_ms: 1, accepted_by: 'alice',
  });
  await flush(4);
  h.reply('room.join', 'room.join.ok', { room_id: 'r-1', participant_id: 'p-1', participants: [], tracks: [] });
  await flush(6);
}

async function inMeeting(h: Harness): Promise<void> {
  const joining = h.engine.joinRoom('m-1', 'tk');
  await flush(4);
  h.reply('room.join', 'room.join.ok', { room_id: 'm-1', participant_id: 'p-1', participants: [], tracks: [] });
  await joining;
  await flush(4);
}

async function idle(): Promise<void> {}

// ── 四格表 ─────────────────────────────────────────────────

interface MethodCase {
  /** 能调通的前置状态。 */
  ready: (h: Harness) => Promise<void>;
  /** 状态机会就地拒掉的前置状态。 */
  wrongState: (h: Harness) => Promise<void>;
  invoke: (e: CallEngine) => Promise<unknown>;
  /** 这次调用直接发出的那一帧。 */
  frame: string;
  okData?: (sent: Record<string, unknown>) => Record<string, unknown>;
  /** 成功时 resolve 的值（不写就不比）。 */
  value?: unknown;
}

const METHODS: Readonly<Record<string, MethodCase>> = {
  call: {
    ready: idle, wrongState: ringing, invoke: (e) => e.call(['bob'], 'audio'), frame: 'call.invite',
    okData: () => ({ call_id: 'c-9', room_id: 'r-9', room_token: 'rt', timeout_sec: 30 }), value: 'c-9',
  },
  joinCall: { ready: idle, wrongState: ringing, invoke: (e) => e.joinCall('c-9'), frame: 'call.join' },
  accept: { ready: ringing, wrongState: idle, invoke: (e) => e.accept(), frame: 'call.accept' },
  reject: { ready: ringing, wrongState: idle, invoke: (e) => e.reject(), frame: 'call.reject' },
  cancel: { ready: inviting, wrongState: idle, invoke: (e) => e.cancel(), frame: 'call.cancel' },
  hangup: { ready: inCall, wrongState: idle, invoke: (e) => e.hangup(), frame: 'call.hangup' },
  inviteMore: { ready: inCall, wrongState: idle, invoke: (e) => e.inviteMore(['carol']), frame: 'call.invite_more' },
  joinRoom: { ready: idle, wrongState: inMeeting, invoke: (e) => e.joinRoom('m-2', 'tk'), frame: 'room.join',
    okData: () => ({ room_id: 'm-2', participant_id: 'p-2', participants: [], tracks: [] }) },
  leaveRoom: { ready: inMeeting, wrongState: idle, invoke: (e) => e.leaveRoom(), frame: 'room.leave' },
  publishMicrophone: { ready: inMeeting, wrongState: idle, invoke: (e) => e.publishMicrophone(), frame: 'room.publish',
    okData: (sent) => ({ cid: sent['cid'], track_id: 't-1' }) },
  openCamera: { ready: inMeeting, wrongState: idle, invoke: (e) => e.openCamera(), frame: 'room.publish',
    okData: (sent) => ({ cid: sent['cid'], track_id: 't-2' }) },
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe.each(Object.entries(METHODS))('%s 的结果回给调用方', (_name, m) => {
  it('成功：直接那一帧收到 .ok 就 resolve', async () => {
    const h = await setup();
    await m.ready(h);
    const pending = m.invoke(h.engine);
    await flush(6);
    const sent = h.latest().frames().filter((f) => f.type === m.frame).at(-1);
    expect(sent, `应当发出 ${m.frame}`).toBeDefined();
    h.reply(m.frame, `${m.frame}.ok`, m.okData?.(sent?.data ?? {}) ?? {});
    const value = await pending;
    if (m.value !== undefined) expect(value).toBe(m.value);
    expect(h.errors).toEqual([]);
  });

  it('本地拒绝：reject 2005，不发帧、不发 error 事件', async () => {
    const h = await setup();
    await m.wrongState(h);
    const before = h.latest().frames().filter((f) => f.type === m.frame).length;
    await expect(m.invoke(h.engine)).rejects.toMatchObject({ code: ErrorCode.invalidState });
    expect(h.latest().frames().filter((f) => f.type === m.frame)).toHaveLength(before);
    expect(h.errors).toEqual([]);
  });

  it('服务端拒绝：reject 那个码并带 forType，不发 error 事件', async () => {
    const h = await setup();
    await m.ready(h);
    const pending = m.invoke(h.engine);
    await flush(6);
    h.rejectRequest(m.frame, ErrorCode.internal);
    await expect(pending).rejects.toMatchObject({ code: ErrorCode.internal, forType: m.frame });
    await flush(6);
    expect(h.errors).toEqual([]);
  });

  it('等应答期间断线：reject 2003 并带 forType，不发 error 事件', async () => {
    const h = await setup();
    await m.ready(h);
    const pending = m.invoke(h.engine);
    await flush(6);
    h.latest().closeFromServer(1006);
    await expect(pending).rejects.toMatchObject({ code: ErrorCode.networkUnreachable, forType: m.frame });
    await flush(6);
    expect(h.errors.filter((e) => e.forType === m.frame)).toEqual([]);
  });
});

describe('本地参数关卡只在空闲时抢先拦', () => {
  it('响铃中误调 call()（名单含自己）：按状态机 reject 2005，不给正在响的那通发假的 callEnd', async () => {
    const h = await setup();
    await ringing(h);
    await expect(h.engine.call(['alice'], 'audio')).rejects.toMatchObject({ code: ErrorCode.invalidState });
    expect(h.callEnds).toEqual([]);
    expect(h.engine.state.call.state).toBe('ringing');
    expect(h.errors).toEqual([]);
  });
});

describe('退出类失败：本地照样收场（D2）', () => {
  it('hangup 被拒（1402）：reject 给调用方，callEnd 照发一次、状态回 idle', async () => {
    const h = await setup();
    await inCall(h);
    const hanging = h.engine.hangup();
    await flush(4);
    h.rejectRequest('call.hangup', ErrorCode.callEnded);
    await expect(hanging).rejects.toMatchObject({ code: ErrorCode.callEnded });
    await flush(4);
    expect(h.callEnds).toEqual(['hangup']);
    expect(h.engine.state.call.state).toBe('idle');
    expect(h.engine.state.room.state).toBe('idle');
    expect(h.errors).toEqual([]);

    // 服务端随后的 call.ended 不再抛第二次。
    h.event('call.ended', { call_id: 'c-1', room_id: 'r-1', reason: 'hangup', duration_sec: 3, ended_by: 'alice' });
    await flush(4);
    expect(h.callEnds).toHaveLength(1);
  });

  it('reject 被拒：来电屏照样收起', async () => {
    const h = await setup();
    await ringing(h);
    const rejecting = h.engine.reject();
    await flush(4);
    h.rejectRequest('call.reject', ErrorCode.callNotFound);
    await expect(rejecting).rejects.toMatchObject({ code: ErrorCode.callNotFound });
    await flush(4);
    expect(h.callEnds).toEqual(['reject']);
    expect(h.engine.state.call.state).toBe('idle');
  });

  it('leaveRoom 等应答时断线：reject 2003，roomLeft 照发、房间回 idle', async () => {
    const h = await setup();
    await inMeeting(h);
    const leaving = h.engine.leaveRoom();
    await flush(4);
    h.latest().closeFromServer(1006);
    await expect(leaving).rejects.toMatchObject({ code: ErrorCode.networkUnreachable, forType: 'room.leave' });
    await flush(6);
    expect(h.roomLefts).toEqual(['m-1']);
    expect(h.engine.state.room.state).toBe('idle');
  });

  it('hangup 等应答时断线：reject 2003，callEnd 照发、状态回 idle', async () => {
    const h = await setup();
    await inCall(h);
    const hanging = h.engine.hangup();
    await flush(4);
    h.latest().closeFromServer(1006);
    await expect(hanging).rejects.toMatchObject({ code: ErrorCode.networkUnreachable, forType: 'call.hangup' });
    await flush(6);
    expect(h.callEnds).toEqual(['hangup']);
    expect(h.engine.state.call.state).toBe('idle');
  });
});

describe('连锁帧失败找不到调用方，走 error 事件（R2）', () => {
  it('accept 已经成功；随后自动发的 room.join 被拒 → error{forType:room.join}', async () => {
    const h = await setup();
    await ringing(h);
    const accepting = h.engine.accept();
    await flush(4);
    h.reply('call.accept', 'call.accept.ok');
    await expect(accepting).resolves.toBeUndefined();
    h.event('call.connected', {
      call_id: 'c-1', room_id: 'r-1', room_token: 'rt-1', media_type: 'audio',
      is_group: true, connected_at_ms: 1, accepted_by: 'alice',
    });
    await flush(4);
    h.rejectRequest('room.join', ErrorCode.roomNotFound);
    await flush(6);
    expect(h.errors).toEqual([{ code: ErrorCode.roomNotFound, forType: 'room.join' }]);
  });

  it('进房中发布：意图被缓存，调用立即 resolve；重放出去的那一帧被拒走 error 事件', async () => {
    const h = await setup();
    const joining = h.engine.joinRoom('m-1', 'tk');
    await flush(4);
    await expect(h.engine.publishMicrophone()).resolves.toEqual(expect.any(String));
    expect(h.latest().frames().some((f) => f.type === 'room.publish')).toBe(false);

    h.reply('room.join', 'room.join.ok', { room_id: 'm-1', participant_id: 'p-1', participants: [], tracks: [] });
    await joining;
    await flush(6);
    h.rejectRequest('room.publish', ErrorCode.publishDenied);
    await flush(6);
    expect(h.errors).toEqual([{ code: ErrorCode.publishDenied, forType: 'room.publish' }]);
  });
});

describe('提示类与清理类不 reject（D3）', () => {
  it('closeMicrophone：room.mute 被拒不 reject，走 error 事件', async () => {
    const h = await setup();
    await inMeeting(h);
    const publishing = h.engine.publishMicrophone();
    await flush(6);
    const sent = h.latest().frames().filter((f) => f.type === 'room.publish').at(-1);
    h.reply('room.publish', 'room.publish.ok', { cid: sent?.data['cid'], track_id: 't-1' });
    await publishing;
    await flush(4);

    const closing = h.engine.closeMicrophone();
    await flush(6);
    h.rejectRequest('room.mute', ErrorCode.trackNotFound);
    await expect(closing).resolves.toBeUndefined();
    expect(h.errors).toEqual([{ code: ErrorCode.trackNotFound, forType: 'room.mute' }]);
  });

  it('setRemoteLayer：room.update_layer 被拒不 reject，走 error 事件', async () => {
    const h = await setup();
    const joining = h.engine.joinRoom('m-1', 'tk');
    await flush(4);
    h.reply('room.join', 'room.join.ok', {
      room_id: 'm-1', participant_id: 'p-1', participants: [],
      tracks: [{ track_id: 'bob-cam', uid: 'bob', kind: 'video', source: 'camera', simulcast: true, muted: false }],
    });
    await joining;
    await flush(6);

    const layering = h.engine.setRemoteLayer('bob', 'l');
    await flush(6);
    h.rejectRequest('room.update_layer', ErrorCode.layerUnavailable);
    await expect(layering).resolves.toBeUndefined();
    expect(h.errors).toEqual([{ code: ErrorCode.layerUnavailable, forType: 'room.update_layer' }]);
  });
});
