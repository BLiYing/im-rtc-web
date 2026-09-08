import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallEngine } from '../src/engine.js';
import { ErrorCode } from '../src/errors.js';
import { NullMedia } from './nullMedia.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';

/**
 * **卡在中间态**这一类毛病的回归。
 *
 * 它们的症状永远长同一个样：界面停在一个转圈的屏上，之后每个动作都被不变量本地拒成
 * 2005，宿主只看到一串没头没尾的 2005，真正的原因早淹在上一条 error 里了。
 * 单测状态机看不出这一类——那一层永远收到「帧发出去了」的假设。
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
  sockets: FakeWebSocket[];
  latest: () => FakeWebSocket;
  errors: { code: number; name: string }[];
  callEnds: { reason: string }[];
  roomLefts: { roomId: string }[];
  /** reply 给某个已发出的帧回一条应答（按 type 找它的 req_id）。 */
  reply: (forType: string, type: string, data?: Record<string, unknown>) => void;
  /** rejectRequest 给某个已发出的帧回一条 sys.error。 */
  rejectRequest: (forType: string, code: number) => void;
  /** event 推一条服务端主动事件（req_id 恒为 ''）。 */
  event: (type: string, data: Record<string, unknown>) => void;
}

function newEngine(sockets: FakeWebSocket[]): CallEngine {
  return new CallEngine({
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
}

async function setup(): Promise<Harness> {
  const sockets: FakeWebSocket[] = [];
  const engine = newEngine(sockets);

  const errors: { code: number; name: string }[] = [];
  const callEnds: { reason: string }[] = [];
  const roomLefts: { roomId: string }[] = [];
  engine.on('error', (e) => errors.push({ code: e.code, name: e.name }));
  engine.on('callEnd', (e) => callEnds.push({ reason: e.reason }));
  engine.on('roomLeft', (e) => roomLefts.push({ roomId: e.roomId }));

  const login = engine.login('token');
  await flush(6);
  const hello = sockets[0]?.lastFrame();
  sockets[0]?.receive(JSON.stringify({
    type: 'sys.hello.ok', req_id: hello?.req_id ?? '', ts: 1, data: HELLO_OK_DATA,
  }));
  await login;

  const latest = (): FakeWebSocket => sockets.at(-1) as FakeWebSocket;
  const reqIdOf = (forType: string): string =>
    latest().frames().filter((f) => f.type === forType).at(-1)?.req_id ?? '';

  return {
    engine,
    sockets,
    latest,
    errors,
    callEnds,
    roomLefts,
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
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/*
  服务端把某个 int 位置发成了字符串——`decodeFields` 会抛 bad_params，而抛出的位置在
  `PendingRequests.settle` 里：waiter 已经摘掉、超时也已经清掉，`resolve` 却还没执行。
  那个 `request()` 的 promise 从此永远不落定，房间机永远停在 joining，而异常从
  `onmessage` 冲出去成了未捕获错误，宿主一条都收不到。
  iOS 与 Android 本来就有兜底，本端是四端里唯一漏掉的。
*/
describe('解不动的应答帧不能把请求挂死', () => {
  it('坏 room.join.ok 照样把房间推进到 joined，并报一条 error', async () => {
    const h = await setup();
    const joining = h.engine.joinRoom('r-1', 'tk');
    await flush(4);

    // max_participants 声明是 int，服务端给了字符串。
    h.reply('room.join', 'room.join.ok', {
      room_id: 'r-1', participant_id: 'p-1', max_participants: '9',
      participants: [], tracks: [],
    });
    await joining;
    await flush(6);

    expect(h.engine.state.room.state, '不能卡在 joining').toBe('joined');
    expect(h.errors.some((e) => e.code === ErrorCode.badParams), '要让宿主知道对端发了坏帧').toBe(true);
  });
});

/*
  没有连接不是「什么都不做」，是一次失败。原先 sendFrame 直接 return：状态机已经迁移过了，
  帧却没发出去，既不回滚也不报错——通话机永久停在 inviting，hangup 被拒成 2005、
  cancel 产出的帧同样被丢掉，再也回不到 idle。
*/
describe('没登录就动手：要收场，不能卡死', () => {
  it('call() 抛 2007 并走 callEnd，状态回 idle', async () => {
    const sockets: FakeWebSocket[] = [];
    const engine = newEngine(sockets);
    const errors: number[] = [];
    const ends: string[] = [];
    engine.on('error', (e) => errors.push(e.code));
    engine.on('callEnd', (e) => ends.push(e.reason));

    await engine.call(['bob'], 'audio');
    await flush(4);

    expect(errors).toContain(ErrorCode.notLoggedIn);
    expect(ends, 'callEnd 是所有结束分支的唯一出口，界面只认它').toEqual(['error']);
    expect(engine.state.call.state, '不能停在 inviting').toBe('idle');
  });

  it('收场之后还能正常再打一通', async () => {
    const h = await setup();
    // 不 await：invite 的应答要等服务端，而这条用例只关心「帧发得出去」。
    void h.engine.call(['bob'], 'audio');
    await flush(4);
    // 上一通若卡在 inviting，这一通会被状态机以 2005 本地拒掉、一帧都发不出去。
    expect(h.latest().frames().some((f) => f.type === 'call.invite')).toBe(true);
  });
});

/*
  只映射 call.invite 是不够的：accept / join 被拒时通话机滞留在 accepting，
  而 reject() 要求 ringing——来电屏上两个按钮全点不动，一个出口都没有。
  Android 的 onRequestFailed 早就把这两个 type 一起接了。
*/
describe('接听被拒也要退回 idle', () => {
  it('call.accept 被服务端拒掉：抛 callEnd 并回 idle', async () => {
    const h = await setup();
    h.event('call.incoming', {
      call_id: 'c-1', room_id: 'r-1', caller: 'bob', callee_ids: ['alice'],
      media_type: 'audio', is_group: false, timeout_sec: 30, user_data: '',
    });
    await flush(4);
    expect(h.engine.state.call.state).toBe('ringing');

    // 不 await：accept 的 promise 要等应答，而这条用例正是要拿应答去拒它。
    void h.engine.accept();
    await flush(2);
    expect(h.engine.state.call.state).toBe('accepting');

    h.rejectRequest('call.accept', ErrorCode.callEnded);
    await flush(6);

    expect(h.engine.state.call.state, '不能停在 accepting——那一屏没有出口').toBe('idle');
    expect(h.callEnds.map((e) => e.reason)).toEqual(['error']);
  });
});

/*
  离房被拒（1203 说的正是「你已经不在房里了」）不接的话房间永久停在 leaving：
  onRoomLeft 抛不出去 → 媒体面不归零 → 摄像头指示灯一直亮，
  而之后每次 join / leave 都被本地拒成 2005。
*/
describe('离房被拒也要收场', () => {
  it('room.leave 被拒：抛 onRoomLeft 并回 idle，之后还能再进房', async () => {
    const h = await setup();
    const joining = h.engine.joinRoom('r-1', 'tk');
    await flush(4);
    h.reply('room.join', 'room.join.ok', {
      room_id: 'r-1', participant_id: 'p-1', participants: [], tracks: [],
    });
    await joining;
    await flush(4);

    void h.engine.leaveRoom();
    await flush(2);
    h.rejectRequest('room.leave', ErrorCode.notInRoom);
    await flush(6);

    expect(h.engine.state.room.state).toBe('idle');
    expect(h.roomLefts.map((e) => e.roomId)).toEqual(['r-1']);

    // 真正要紧的是这一条：不回 idle 的话这台 engine 再也进不了任何房间。
    void h.engine.joinRoom('r-2', 'tk2');
    await flush(4);
    expect(h.latest().frames().some((f) => f.data['room_id'] === 'r-2')).toBe(true);
  });
});

/*
  两条 WS 带着同一个 uid + device_id，服务端按顶号把先来的那条踢下线，宿主收到一个
  **假的 kickedOut{takenOver}**；而旧那条从不 close，它已经武装好的 ResumeDeadline
  约 75 秒后照样触发，把新会话的房间清掉。iOS 的 login 早就是这条规矩。
*/
describe('重复 login 要就地拒掉', () => {
  it('已经登录时再 login 抛 2005，且不开第二条 socket', async () => {
    const h = await setup();
    const before = h.sockets.length;

    await expect(h.engine.login('another')).rejects.toMatchObject({ code: ErrorCode.invalidState });
    expect(h.sockets.length, '不能再开一条把自己顶下线').toBe(before);
  });

  it('登录失败会把摊子收干净——否则重试也被那道门挡掉', async () => {
    const sockets: FakeWebSocket[] = [];
    const engine = newEngine(sockets);

    const first = engine.login('bad-token');
    await flush(6);
    const hello = sockets[0]?.lastFrame();
    sockets[0]?.receive(JSON.stringify({
      type: 'sys.error', req_id: hello?.req_id ?? '', ts: 1,
      data: {
        code: ErrorCode.tokenInvalid, name: 'token_invalid', msg: 'x',
        for_type: 'sys.hello', retryable: false,
      },
    }));
    await expect(first).rejects.toBeDefined();

    // 换一枚好票重来：不收摊的话这里会撞上「已经登录了」。
    const second = engine.login('good-token');
    await flush(6);
    const hello2 = sockets.at(-1)?.lastFrame();
    sockets.at(-1)?.receive(JSON.stringify({
      type: 'sys.hello.ok', req_id: hello2?.req_id ?? '', ts: 1, data: HELLO_OK_DATA,
    }));
    await expect(second).resolves.toMatchObject({ uid: 'alice' });
  });
});
