import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallEngine } from '../src/engine.js';
import { ErrorCode } from '../src/errors.js';
import { NullMedia } from './nullMedia.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';

/**
 * `CallEngine.call()` 的 `options` 参数与 `joinCall()`（HOST_INTEGRATION_DESIGN §3.3）。
 *
 * 状态机那半（chat_group_id / user_data 怎么进出帧、怎么回落）由 callMachine.test.ts 覆盖；
 * 这里守的是**门面这一层**：布尔与对象两种 `options` 的兼容、本地校验的出口、
 * 以及 `joinCall` 真的把 `call.join` 发上了线路。
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
  callEnds: { reason: string }[];
  errors: { code: number }[];
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
  const h: Harness = {
    engine,
    latest: (): FakeWebSocket => sockets.at(-1) as FakeWebSocket,
    callEnds: [],
    errors: [],
  };
  engine.on('callEnd', (e) => h.callEnds.push({ reason: e.reason }));
  engine.on('error', (e) => h.errors.push({ code: e.code }));

  const login = engine.login('token');
  await flush(6);
  const hello = sockets[0]?.lastFrame();
  sockets[0]?.receive(JSON.stringify({
    type: 'sys.hello.ok', req_id: hello?.req_id ?? '', ts: 1, data: HELLO_OK_DATA,
  }));
  await login;
  return h;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('call() 的 options', () => {
  it('传布尔值等同旧的 isGroup 参数', async () => {
    const h = await setup();
    void h.engine.call(['bob'], 'audio', true);
    await flush(4);
    const invite = h.latest().frames().find((f) => f.type === 'call.invite');
    expect(invite?.data['is_group']).toBe(true);
    // 上线路的帧经过 encodeFields，省略的字段会被**填成协议默认值**（空串），
    // 这与 callMachine.test.ts 里直接看 reduceCall 原始产出（键整个不存在）是两回事。
    expect(invite?.data['chat_group_id']).toBe('');
  });

  it('传 CallOptions 时群号 / user_data / 超时都上线路', async () => {
    const h = await setup();
    void h.engine.call(['bob', 'carol'], 'video', {
      isGroup: true, chatGroupId: 'g-42', userData: '{"n":1}', timeoutSec: 45,
    });
    await flush(4);
    const invite = h.latest().frames().find((f) => f.type === 'call.invite');
    expect(invite?.data).toMatchObject({
      is_group: true, chat_group_id: 'g-42', user_data: '{"n":1}', timeout_sec: 45,
    });
  });

  it('chatGroupId 超 64 字节：本地就地拒掉，不发帧；1004 回给调用方，界面出口仍是 callEnd(error)', async () => {
    const h = await setup();
    const tooLong = 'g'.repeat(65);
    await expect(h.engine.call(['bob'], 'audio', { chatGroupId: tooLong })).rejects.toMatchObject({
      code: ErrorCode.badParams, forType: 'call.invite',
    });
    expect(h.latest().frames().some((f) => f.type === 'call.invite')).toBe(false);
    // 一次失败只从一个出口报：已经交给调用方的错误不再发 error 事件。
    expect(h.errors).toEqual([]);
    expect(h.callEnds.map((e) => e.reason)).toEqual(['error']);
  });

  it('chatGroupId 含空白：本地就地拒掉', async () => {
    const h = await setup();
    await expect(h.engine.call(['bob'], 'audio', { chatGroupId: 'g 42' })).rejects.toMatchObject({
      code: ErrorCode.badParams,
    });
    expect(h.latest().frames().some((f) => f.type === 'call.invite')).toBe(false);
    expect(h.callEnds.map((e) => e.reason)).toEqual(['error']);
  });

  it('userData 超 4096 字节：本地就地拒掉', async () => {
    const h = await setup();
    await expect(h.engine.call(['bob'], 'audio', { userData: 'x'.repeat(4097) })).rejects.toMatchObject({
      code: ErrorCode.badParams,
    });
    expect(h.latest().frames().some((f) => f.type === 'call.invite')).toBe(false);
    expect(h.callEnds.map((e) => e.reason)).toEqual(['error']);
  });

  it('名单里含自己 优先于 chatGroupId 校验，两条规则不会重复拒两次', async () => {
    const h = await setup();
    await expect(h.engine.call(['alice'], 'audio', { chatGroupId: 'x'.repeat(65) })).rejects.toMatchObject({
      code: ErrorCode.badParams,
    });
    expect(h.callEnds).toHaveLength(1);
    expect(h.errors).toEqual([]);
  });

  it('成功时 resolve 服务端分配的 callId', async () => {
    const h = await setup();
    const calling = h.engine.call(['bob'], 'audio');
    await flush(4);
    const invite = h.latest().frames().find((f) => f.type === 'call.invite');
    h.latest().receive(JSON.stringify({
      type: 'call.invite.ok', req_id: invite?.req_id ?? '', ts: 1,
      data: { call_id: 'call-7', room_id: 'r-7', room_token: 'tk', timeout_sec: 30 },
    }));
    await expect(calling).resolves.toBe('call-7');
    expect(h.errors).toEqual([]);
  });
});

describe('joinCall()', () => {
  it('发出 call.join，状态机进 accepting；call.join.ok + call.connected 之后进 connecting', async () => {
    const h = await setup();
    const joining = h.engine.joinCall('call-9');
    await flush(4);

    const join = h.latest().frames().find((f) => f.type === 'call.join');
    expect(join?.data).toEqual({ call_id: 'call-9' });
    expect(h.engine.state.call.state).toBe('accepting');

    h.latest().receive(JSON.stringify({
      type: 'call.join.ok', req_id: join?.req_id ?? '', ts: 1, data: {},
    }));
    await joining;
    await flush(2);

    h.latest().receive(JSON.stringify({
      type: 'call.connected', req_id: '', ts: 1,
      data: {
        call_id: 'call-9', room_id: 'r-9', room_token: 'tk', media_type: 'video',
        is_group: true, connected_at_ms: 1, accepted_by: 'alice', caller: 'frank',
        chat_group_id: 'g-42', user_data: '',
      },
    }));
    await flush(4);
    expect(h.engine.state.call.state).toBe('connecting');
  });

  it('服务端拒绝（如 1409）时 reject 那个码、退回 idle 并照发 callEnd(error)，不再发 error 事件', async () => {
    const h = await setup();
    const joining = h.engine.joinCall('call-9');
    await flush(4);
    const join = h.latest().frames().find((f) => f.type === 'call.join');
    h.latest().receive(JSON.stringify({
      type: 'sys.error', req_id: join?.req_id ?? '', ts: 1,
      data: { code: 1409, name: 'invite_denied', msg: 'invite denied by host', for_type: 'call.join', retryable: false },
    }));
    await expect(joining).rejects.toMatchObject({ code: ErrorCode.inviteDenied, forType: 'call.join' });
    await flush(4);

    expect(h.engine.state.call.state).toBe('idle');
    expect(h.callEnds.map((e) => e.reason)).toEqual(['error']);
    expect(h.errors).toEqual([]);
  });
});
