import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallEngine } from '../src/engine.js';
import { NullMedia } from './nullMedia.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';

/**
 * `openMicrophone` / `closeMicrophone` / `openCamera` / `closeCamera`（按类型的媒体开关，
 * 与腾讯 TUICallEngine 同名）与 `destroy()`（终态销毁）的接线测试。
 *
 * open/close 的编排本身（该发布就发布、已发布就 setMuted）在 `publishMicrophone` /
 * `publishCamera` / `setMuted` 里已经有各自的媒体层测试（`localPreview.test.ts` 等）；
 * 这里只守**门面这一层挑对了路径**：还没发布过 → 走发布；已经发布过 → 走 setMuted，
 * 不重新发布（重复发布同一路会在 pub PC 上多挂一条 sender）。
 *
 * **「发没发布过」问的是 `media.publishedMicrophoneCid()` / `publishedCameraCid()`**
 * （媒体适配器自己的账），不是门面另开一份影子记账——2026-09-15 iOS 在等价实现上踩过：
 * 门面自己那份账只认自己发布过的那一路，宿主先直接调 `publishMicrophone()` 发布过、
 * 再调 `openMicrophone()` 就会被误判成「没发布」而重复发布。「先 publish* 再 open*」
 * 那两条用例专门钉住这条。
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
  reply: (forType: string, type: string, data?: Record<string, unknown>) => void;
}

/** setup 登录并进一个会议房（直接 joinRoom，不走振铃——媒体开关不关心是不是通话）。 */
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
    reply: (): void => undefined,
  };

  const login = engine.login('token');
  await flush(6);
  const hello = sockets[0]?.lastFrame();
  sockets[0]?.receive(JSON.stringify({
    type: 'sys.hello.ok', req_id: hello?.req_id ?? '', ts: 1, data: HELLO_OK_DATA,
  }));
  await login;

  const reqIdOf = (forType: string): string =>
    h.latest().frames().filter((f) => f.type === forType).at(-1)?.req_id ?? '';
  h.reply = (forType, type, data = {}): void => {
    h.latest().receive(JSON.stringify({ type, req_id: reqIdOf(forType), ts: 1, data }));
  };

  const joining = engine.joinRoom('r-1', 'rt-1');
  await flush(4);
  h.reply('room.join', 'room.join.ok', {
    room_id: 'r-1', participant_id: 'r-1-p1', participants: [], tracks: [],
  });
  await joining;
  expect(engine.state.room.state).toBe('joined');
  return h;
}

/** publish 把一次 room.publish 请求回成功——回 publish.ok 再回 offer 的 answer，直到发布方法落地。 */
async function completePublish(h: Harness, pending: Promise<unknown>, cid: string): Promise<void> {
  await flush(4);
  h.reply('room.publish', 'room.publish.ok', { cid, track_id: `t-${cid}` });
  await flush(6);
  h.reply('room.offer', 'room.answer', { pc: 'pub', sdp: 'answer-sdp' });
  await pending;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('openMicrophone / closeMicrophone：按类型的便捷开关', () => {
  it('还没发布过：走发布路径，落地后记住 cid', async () => {
    const h = await setup();
    const opening = h.engine.openMicrophone();
    await completePublish(h, opening, 'mic-1');
    expect(h.engine.state.room.publish['mic-1']).toBe('published');
  });

  it('已经发布过：不再发第二次 room.publish，直接 setMuted(cid, false)', async () => {
    const h = await setup();
    const first = h.engine.openMicrophone();
    await completePublish(h, first, 'mic-1');
    const publishFrames = h.latest().frames().filter((f) => f.type === 'room.publish').length;

    const reopening = h.engine.openMicrophone();
    await flush(4);
    h.reply('room.mute', 'room.mute.ok');
    await reopening;

    expect(h.latest().frames().filter((f) => f.type === 'room.publish')).toHaveLength(publishFrames);
    const mute = h.latest().frames().filter((f) => f.type === 'room.mute').at(-1);
    expect(mute?.data['track_id']).toBe('t-mic-1');
    expect(mute?.data['muted']).toBe(false);
  });

  it('closeMicrophone：对已发布的轨道 setMuted(cid, true)，不 unpublish', async () => {
    const h = await setup();
    const opening = h.engine.openMicrophone();
    await completePublish(h, opening, 'mic-1');

    const closing = h.engine.closeMicrophone();
    await flush(4);
    h.reply('room.mute', 'room.mute.ok');
    await closing;

    expect(h.latest().frames().some((f) => f.type === 'room.unpublish')).toBe(false);
    const mute = h.latest().frames().filter((f) => f.type === 'room.mute').at(-1);
    expect(mute?.data['track_id']).toBe('t-mic-1');
    expect(mute?.data['muted']).toBe(true);
  });

  it('closeMicrophone：从没发布过是空操作，不发任何帧', async () => {
    const h = await setup();
    const before = h.latest().frames().length;
    await h.engine.closeMicrophone();
    await flush(4);
    expect(h.latest().frames()).toHaveLength(before);
  });

  /*
   * 2026-09-15 iOS 踩过的坑：如果 openMicrophone 自己另开一份「发布过没有」的账，
   * 只认自己发布过的那一路，就会把「宿主直接调 publishMicrophone() 发布过」判成
   * 「没发布过」，再调一次 openMicrophone() 就在 pub PC 上多挂一条 sender——同一路
   * 麦克风被发布两次。「发没发布过」必须问媒体适配器自己的账（engine.ts 的
   * `media.publishedMicrophoneCid()`），不能是门面另开的一份影子记账。
   */
  it('先直接调 publishMicrophone() 发布过，再调 openMicrophone()：不重复发布，只取消静音', async () => {
    const h = await setup();
    const publishing = h.engine.publishMicrophone();
    await completePublish(h, publishing, 'mic-1');
    const publishFrames = h.latest().frames().filter((f) => f.type === 'room.publish').length;

    const opening = h.engine.openMicrophone();
    await flush(4);
    h.reply('room.mute', 'room.mute.ok');
    await opening;

    expect(h.latest().frames().filter((f) => f.type === 'room.publish')).toHaveLength(publishFrames);
    const mute = h.latest().frames().filter((f) => f.type === 'room.mute').at(-1);
    expect(mute?.data['track_id']).toBe('t-mic-1');
    expect(mute?.data['muted']).toBe(false);
  });
});

describe('openCamera / closeCamera：按类型的便捷开关', () => {
  it('还没发布过：走发布路径（复用 publishCamera 现有逻辑）', async () => {
    const h = await setup();
    const opening = h.engine.openCamera();
    await completePublish(h, opening, 'cam-1');
    expect(h.engine.state.room.publish['cam-1']).toBe('published');
  });

  it('已经发布过：不重新发布，直接 setMuted(cid, false)', async () => {
    const h = await setup();
    const first = h.engine.openCamera();
    await completePublish(h, first, 'cam-1');
    const publishFrames = h.latest().frames().filter((f) => f.type === 'room.publish').length;

    const reopening = h.engine.openCamera();
    await flush(4);
    h.reply('room.mute', 'room.mute.ok');
    await reopening;

    expect(h.latest().frames().filter((f) => f.type === 'room.publish')).toHaveLength(publishFrames);
    const mute = h.latest().frames().filter((f) => f.type === 'room.mute').at(-1);
    expect(mute?.data['muted']).toBe(false);
  });

  it('closeCamera：setMuted(cid, true)，没发布过是空操作', async () => {
    const h = await setup();
    const before = h.latest().frames().length;
    await h.engine.closeCamera();
    await flush(4);
    expect(h.latest().frames()).toHaveLength(before);

    const opening = h.engine.openCamera();
    await completePublish(h, opening, 'cam-1');
    const closing = h.engine.closeCamera();
    await flush(4);
    h.reply('room.mute', 'room.mute.ok');
    await closing;
    const mute = h.latest().frames().filter((f) => f.type === 'room.mute').at(-1);
    expect(mute?.data['muted']).toBe(true);
  });

  /** 同麦克风那条：「发没发布过」问的是 media.publishedCameraCid()，不是门面自己的账。 */
  it('先直接调 publishCamera() 发布过，再调 openCamera()：不重复发布，只取消静音', async () => {
    const h = await setup();
    const publishing = h.engine.publishCamera();
    await completePublish(h, publishing, 'cam-1');
    const publishFrames = h.latest().frames().filter((f) => f.type === 'room.publish').length;

    const opening = h.engine.openCamera();
    await flush(4);
    h.reply('room.mute', 'room.mute.ok');
    await opening;

    expect(h.latest().frames().filter((f) => f.type === 'room.publish')).toHaveLength(publishFrames);
    const mute = h.latest().frames().filter((f) => f.type === 'room.mute').at(-1);
    expect(mute?.data['track_id']).toBe('t-cam-1');
    expect(mute?.data['muted']).toBe(false);
  });
});

describe('destroy：终态销毁', () => {
  it('logout 掉连接、清空事件订阅；之后再收不到任何事件', async () => {
    const h = await setup();
    const seen: string[] = [];
    h.engine.on('roomLeft', () => seen.push('roomLeft'));
    h.engine.on('error', () => seen.push('error'));

    h.engine.destroy();
    expect(h.latest().closedWith).not.toBeNull();

    // 销毁之后再调会抛 2005，事件订阅也已经清空——两条都要成立才算「终态」。
    await expect(h.engine.hangup()).rejects.toMatchObject({ code: 2005 });
    expect(seen).toEqual([]);
  });

  it('之后再调发起动作的方法一律抛 2005 invalid_state', async () => {
    const h = await setup();
    h.engine.destroy();

    await expect(h.engine.login('token2')).rejects.toMatchObject({ code: 2005 });
    await expect(h.engine.call(['bob'], 'video')).rejects.toMatchObject({ code: 2005 });
    await expect(h.engine.openMicrophone()).rejects.toMatchObject({ code: 2005 });
    await expect(h.engine.publishMicrophone()).rejects.toMatchObject({ code: 2005 });
  });

  it('logout() / forceEnd() / on() / uid / state 不受影响，销毁后调用仍然安全', () => {
    const engine = new CallEngine({ url: 'ws://test/v1/ws', deviceId: 'd1', media: new NullMedia() });
    engine.destroy();
    expect(() => engine.logout()).not.toThrow();
    expect(() => engine.forceEnd()).not.toThrow();
    expect(() => engine.on('error', () => undefined)).not.toThrow();
    expect(engine.uid).toBe('');
    expect(engine.state.call.state).toBe('idle');
  });

  it('可重复调用：第二次 destroy() 什么也不做，不重复 logout、不抛错', async () => {
    const h = await setup();
    h.engine.destroy();
    const closedAt = h.latest().closedWith;
    expect(() => h.engine.destroy()).not.toThrow();
    expect(h.latest().closedWith).toEqual(closedAt);
  });
});
