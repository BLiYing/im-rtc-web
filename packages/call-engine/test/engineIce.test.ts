import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallEngine } from '../src/engine.js';
import { parseCandidate } from '../src/signaling/candidate.js';
import type { LocalTrackInfo, MediaAdapter, MediaAdapterEvents } from '../src/media/mediaAdapter.js';
import type { PcRole } from '../src/signaling/enums.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';
import { CloseCode } from '../src/signaling/webSocket.js';

/**
 * 双向 trickle ICE 的接线测试。
 *
 * **这条路径一开始整条漏了**：候选只往上发、不往下收。下行连接能不能建立
 * 全看运气——服务端的 SDP 里碰巧带上主机候选就通，没带上就永远停在 `new`，
 * 界面上是「格子在、画面黑」，而且不报任何错。浏览器双开、第二个人进房时必现。
 */

const HELLO_OK_DATA = {
  uid: 'alice', device_id: 'd1', session_id: 's-1', server_time_ms: 1756876800123,
  resumed: false, ping_interval_sec: 15,
  limits: {
    max_frame_bytes: 65536, max_callees: 8, max_room_participants: 9,
    max_user_data_bytes: 4096, ring_timeout_sec_default: 30,
  },
};

/** RecordingMedia 只记下 engine 对媒体层做了什么。 */
class RecordingMedia implements MediaAdapter {
  readonly remoteCandidates: { pc: PcRole; candidate: string }[] = [];
  events: MediaAdapterEvents | null = null;

  iceRestarts = 0;

  open(events: MediaAdapterEvents): void {
    this.events = events;
  }
  async acquireMicrophone(): Promise<LocalTrackInfo> {
    return { cid: 'mic-1', kind: 'audio', source: 'microphone' };
  }
  async probeMicrophone(): Promise<void> {}
  async probeCamera(): Promise<void> {}
  async startLocalPreview(): Promise<LocalTrackInfo> {
    return this.acquireCamera();
  }
  async stopLocalPreview(): Promise<void> {}

  async acquireCamera(): Promise<LocalTrackInfo> {
    return { cid: 'cam-1', kind: 'video', source: 'camera' };
  }
  async createPubOffer(): Promise<string> {
    return 'offer-sdp';
  }
  restartPubICE(): void {
    this.iceRestarts += 1;
  }
  /** 手动模拟一次 PC 状态变化——真实实现里这是浏览器回调过来的。 */
  pcState(pc: PcRole, state: RTCPeerConnectionState): void {
    this.events?.onConnectionStateChange(pc, state);
  }
  async applyPubAnswer(): Promise<void> {}
  async answerSubOffer(): Promise<string> {
    return 'answer-sdp';
  }
  async addRemoteCandidate(pc: PcRole, candidate: RTCIceCandidateInit): Promise<void> {
    this.remoteCandidates.push({ pc, candidate: candidate.candidate ?? '' });
  }
  setMuted(): void {}
  localTrack(): MediaStreamTrack | undefined {
    return undefined;
  }
  close(): void {}
}

async function setup(): Promise<{
  engine: CallEngine; media: RecordingMedia; ws: FakeWebSocket; latest: () => FakeWebSocket;
}> {
  const media = new RecordingMedia();
  // 重连会**换一条**连接，所以要留着每一条：断线重连的用例断言的是新那条上的帧。
  const sockets: FakeWebSocket[] = [];
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

  const login = engine.login('token');
  await flush(6);
  const socket = sockets.at(-1);
  if (socket === undefined) throw new Error('没有建立连接');
  const hello = socket.lastFrame();
  socket.receive(JSON.stringify({
    type: 'sys.hello.ok', req_id: hello?.req_id ?? '', ts: 1, data: HELLO_OK_DATA,
  }));
  await login;
  const latest = (): FakeWebSocket => {
    const s = sockets.at(-1);
    if (s === undefined) throw new Error('没有连接');
    return s;
  };
  return { engine, media, ws: socket, latest };
}

/** joinRoom 把房间推到 joined —— 只有 joined 才允许发布/协商类动作（不变量 R1）。 */
async function joinRoom(ws: FakeWebSocket): Promise<void> {
  deliverEvent(ws, 'call.connected', {
    call_id: 'call-1', room_id: 'r-1', room_token: 'tk', media_type: 'video',
    is_group: false, connected_at_ms: 1756876812000, accepted_by: 'bob',
  });
  await flush(6);
  const join = ws.frames().find((f) => f.type === 'room.join');
  ws.receive(JSON.stringify({
    type: 'room.join.ok', req_id: join?.req_id ?? '', ts: 1,
    data: {
      room_id: 'r-1', room_kind: 'call_1v1', participant_id: 'p-2',
      max_participants: 2, joined_at_ms: 1, participants: [], tracks: [],
    },
  }));
  await flush(8);
}

/** deliverEvent 模拟服务端推一个事件帧（req_id 恒为空）。 */
function deliverEvent(ws: FakeWebSocket, type: string, data: Record<string, unknown>): void {
  ws.receive(JSON.stringify({ type, req_id: '', ts: 1, data }));
}

describe('trickle ICE 是双向的', () => {
  it('服务端来的候选要交给媒体层', async () => {
    const { media, ws } = await setup();

    deliverEvent(ws, 'room.ice_candidate', {
      pc: 'sub', candidate: 'candidate:1 1 udp 2130706431 127.0.0.1 7881 typ host',
      sdp_mid: '0', sdp_mline_index: 0,
    });
    await flush(4);

    expect(media.remoteCandidates).toHaveLength(1);
    expect(media.remoteCandidates[0]?.pc).toBe('sub');
    expect(media.remoteCandidates[0]?.candidate).toContain('typ host');
  });

  it('候选走的是 pc 字段说的那条连接', async () => {
    const { media, ws } = await setup();
    deliverEvent(ws, 'room.ice_candidate', {
      pc: 'pub', candidate: 'candidate:2 1 udp 1 10.0.0.1 5000 typ host',
      sdp_mid: '1', sdp_mline_index: 1,
    });
    await flush(4);
    expect(media.remoteCandidates[0]?.pc).toBe('pub');
  });

  it('空候选表示收集结束，直接忽略（协议 §3.3 要求容忍）', async () => {
    const { media, ws } = await setup();
    deliverEvent(ws, 'room.ice_candidate', {
      pc: 'sub', candidate: '', sdp_mid: '', sdp_mline_index: 0,
    });
    await flush(4);
    expect(media.remoteCandidates).toHaveLength(0);
  });

  it('本端候选要发上去', async () => {
    const { media, ws } = await setup();
    media.events?.onLocalCandidate('sub', {
      candidate: 'candidate:3 1 udp 1 127.0.0.1 6000 typ host', sdpMid: '0', sdpMLineIndex: 0,
    });
    await flush(4);

    const sent = ws.frames().filter((f) => f.type === 'room.ice_candidate');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.data['pc']).toBe('sub');
    expect(sent[0]?.data['sdp_mid']).toBe('0');
  });
});

/**
 * 回调顺序：**onCallBegin 必须排在 onRoomJoined 之前**。
 *
 * 这条是浏览器实测抓到的：`call.connected` 会同时产出一个事件（onCallBegin）
 * 与一帧（room.join）。engine 原本先发帧再抛事件，于是 join.ok 的应答
 * 在本轮事件之前就被处理完了，宿主看到的是 **roomJoined / userEnter
 * 排在 callBegin 前面**——它还没被告知有这通电话，就先收到了房间里的事件。
 */
describe('回调顺序', () => {
  it('callBegin 先于 roomJoined 与 userEnter', async () => {
    const { engine, ws } = await setup();
    const seen: string[] = [];
    for (const name of ['callBegin', 'roomJoined', 'userEnter'] as const) {
      engine.on(name, () => seen.push(name));
    }

    deliverEvent(ws, 'call.incoming', {
      call_id: 'call-1', room_id: 'r-1', caller: 'alice', callee_ids: ['bob'],
      media_type: 'video', is_group: false, timeout_sec: 30, invited_at_ms: 1, user_data: '',
    });
    await flush(4);
    deliverEvent(ws, 'call.connected', {
      call_id: 'call-1', room_id: 'r-1', room_token: 'tk', media_type: 'video',
      is_group: false, connected_at_ms: 1756876812000, accepted_by: 'bob',
    });
    await flush(6);

    // engine 这时正在等 room.join 的应答，回一条 join.ok。
    const join = ws.frames().find((f) => f.type === 'room.join');
    expect(join, '应当发出了 room.join').toBeDefined();
    ws.receive(JSON.stringify({
      type: 'room.join.ok', req_id: join?.req_id ?? '', ts: 1,
      data: {
        room_id: 'r-1', room_kind: 'call_1v1', participant_id: 'p-2',
        max_participants: 2, joined_at_ms: 1,
        participants: [{ participant_id: 'p-1', uid: 'alice', device_id: 'd', joined_at_ms: 1 }],
        tracks: [],
      },
    }));
    await flush(8);

    expect(seen).toEqual(['callBegin', 'roomJoined', 'userEnter']);
  });

  /**
   * 进房失败要把房间状态退回 idle。
   *
   * 不退的话状态机永远停在 `joining`，之后每次 publish 都被不变量 R1 本地拒成
   * 2005 invalid_state——宿主只看到两条没头没尾的 2005，真正的原因
   * （那条 room.join 被服务端拒了）已经淹在上一条 error 里。
   */
  it('room.join 被拒之后房间退回 idle，而不是卡在 joining', async () => {
    const { engine, ws } = await setup();

    // 不 await：joinRoom 要等 room.join 的应答，而应答得等我们下面喂进去。
    void engine.joinRoom('r-1', 'tk');
    await flush(4);
    const join = ws.frames().find((f) => f.type === 'room.join');
    expect(join).toBeDefined();
    expect(engine.state.room.state).toBe('joining');

    ws.receive(JSON.stringify({
      type: 'sys.error', req_id: join?.req_id ?? '', ts: 1,
      data: {
        code: 1204, name: 'already_in_room', msg: 'already in room',
        for_type: 'room.join', retryable: false,
      },
    }));
    await flush(8);

    expect(engine.state.room.state).toBe('idle');
  });
});

/*
 **ICE 失败不是终点，是该重连的信号。**

 `pub` 那条 PC 的 offerer 是本端，所以它 failed 了只能自己救（`sub` 那条由服务端救，协议 §3.3）。
 不救的后果：网抖一下（切网、休眠、标签页被节流久了）人就**永久掉出这通通话**，
 对端格子从此是一块黑，而界面上一切正常、谁也不挂断——真机联调抓到过两条 PC
 从某一刻起五分钟一轮地失败，再没回到 connected。
*/
describe('上行 ICE 断了要自己重连', () => {
  it('pub failed → 置重启位 + 重新发一个 room.offer{pc:pub}', async () => {
    const { media, ws } = await setup();
    await joinRoom(ws);
    const before = ws.frames().filter((f) => f.type === 'room.offer').length;

    media.pcState('pub', 'failed');
    await flush(8);

    expect(media.iceRestarts, '要让下一个 offer 带上 ICE restart').toBe(1);
    const offers = ws.frames().filter((f) => f.type === 'room.offer');
    expect(offers.length, '要重新 offer 一次').toBe(before + 1);
    expect(offers.at(-1)?.data).toMatchObject({ pc: 'pub' });
  });

  it('sub failed 不自己重启（插手只会 glare），但要立刻抛 2006 给宿主', async () => {
    const { engine, media, ws } = await setup();
    const errors: number[] = [];
    engine.on('error', (e) => errors.push(e.code));
    await joinRoom(ws);
    const before = ws.frames().filter((f) => f.type === 'room.offer').length;

    media.pcState('sub', 'failed');
    await flush(8);

    expect(media.iceRestarts).toBe(0);
    expect(ws.frames().filter((f) => f.type === 'room.offer').length).toBe(before);
    /*
      本端不是 offerer，救不了——那就必须让宿主知道（协议 §7.2）。
      原先这里什么都不做，于是下行永久失败在界面上完全无感：格子在、画面黑、计时照走。
    */
    expect(errors, 'sub 救不了就得立即上报').toEqual([2006]);
  });

  /*
    **重试节奏不能没有尽头**（协议 §7.2）。

    一律自愈、永不上报的话，宿主从头到尾收不到任何信号——上面那段「五分钟一轮地失败」
    会一直挂着，而界面上什么都不会变。所以连续 3 次重启后仍 failed 抛一次 2006，
    之后继续重试但不再重复抛；回到 connected 算新一轮，重新计数。
  */
  describe('pub 自愈的放弃阈值', () => {
    it('连续 3 次仍 failed → 抛一次 2006，且仍在继续重试', async () => {
      const { engine, media, ws } = await setup();
      const errors: number[] = [];
      engine.on('error', (e) => errors.push(e.code));
      await joinRoom(ws);

      for (let i = 0; i < 3; i += 1) {
        media.pcState('pub', 'failed');
        await flush(8);
      }

      expect(errors, '第 3 次才放弃').toEqual([2006]);
      expect(media.iceRestarts, '放弃上报之后照样继续救').toBe(3);

      // 第 4、5 次不该再刷——同一轮故障只抛一次。
      media.pcState('pub', 'failed');
      media.pcState('pub', 'failed');
      await flush(8);
      expect(errors, '同一轮只抛一次').toEqual([2006]);
      expect(media.iceRestarts, '但重试没停').toBe(5);
    });

    it('前两次不抛——那多半只是切网抖动', async () => {
      const { engine, media, ws } = await setup();
      const errors: number[] = [];
      engine.on('error', (e) => errors.push(e.code));
      await joinRoom(ws);

      media.pcState('pub', 'failed');
      media.pcState('pub', 'failed');
      await flush(8);

      expect(errors, '抖动不该惊动宿主').toEqual([]);
      expect(media.iceRestarts).toBe(2);
    });

    it('回到 connected 之后重新计数', async () => {
      const { engine, media, ws } = await setup();
      const errors: number[] = [];
      engine.on('error', (e) => errors.push(e.code));
      await joinRoom(ws);

      media.pcState('pub', 'failed');
      media.pcState('pub', 'failed');
      media.pcState('pub', 'connected');
      await flush(8);
      media.pcState('pub', 'failed');
      media.pcState('pub', 'failed');
      await flush(8);

      expect(errors, '救回来过就是新一轮，不该拿旧账凑够 3 次').toEqual([]);
    });
  });
});

/*
 会话恢复之后必须重新协商上行（协议 §1.4：客户端的 pub PC 若已失效则重发
 `room.offer{pc:"pub"}`）。

 **这一条不能只挂在「PC 判 failed 的那一刻」**：网一断信令也跟着断，房间立刻变成
 reconnecting，而 PC 要等约 30 秒才判 failed——那时 `restart_pub_ice` 会被状态机
 本地拒掉，且它不进 BUFFERABLE_OPS，于是永远丢失。iOS 真机 2026-09-07 抓到过
 `动作被状态机本地拒绝 op=restart_pub_ice room_state=reconnecting`，
 三端同一条路，ICE 自愈在它唯一该生效的场景里等于不存在。
*/
describe('会话恢复之后要重新协商上行', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  async function reconnect(
    h: Awaited<ReturnType<typeof setup>>, resumed: boolean,
  ): Promise<void> {
    h.latest().closeFromServer(CloseCode.goingAway, 'restart');
    await flush(4);
    await vi.advanceTimersByTimeAsync(1_400);
    await flush(6);
    const hello = h.latest().lastFrame();
    h.latest().receive(JSON.stringify({
      type: 'sys.hello.ok', req_id: hello?.req_id ?? '', ts: 1,
      data: { ...HELLO_OK_DATA, session_id: 's-2', resumed },
    }));
    await flush(10);
  }

  it('resumed=true → 置重启位 + 补一条 room.offer{pc:pub}', async () => {
    const h = await setup();
    await joinRoom(h.ws);
    const before = h.latest().frames().filter((f) => f.type === 'room.offer').length;

    await reconnect(h, true);

    expect(h.media.iceRestarts, '要让下一个 offer 带上 ICE restart').toBe(1);
    const offers = h.latest().frames().filter((f) => f.type === 'room.offer');
    expect(offers.length, '光置位不发帧等于没做').toBe(before + 1);
    expect(offers.at(-1)?.data).toMatchObject({ pc: 'pub' });
  });

  it('resumed=false 不重协商——那时房间已归零，发上去只会换回 1203', async () => {
    const h = await setup();
    await joinRoom(h.ws);

    await reconnect(h, false);

    expect(h.media.iceRestarts).toBe(0);
    expect(h.latest().frames().filter((f) => f.type === 'room.offer').length).toBe(0);
  });
});

describe('候选解析', () => {
  it('空候选表示收集结束，返回 null', () => {
    // 把它当成一条真候选喂给 addIceCandidate，部分浏览器会抛。
    expect(parseCandidate({ pc: 'sub', candidate: '', sdp_mid: '', sdp_mline_index: 0 })).toBeNull();
    expect(parseCandidate({ pc: 'sub' })).toBeNull();
  });

  it('认不出的 pc 一律当 sub —— 下行才是候选真正要紧的方向', () => {
    const parsed = parseCandidate({ pc: 'whatever', candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host' });
    expect(parsed?.pc).toBe('sub');
    expect(parsed?.init.sdpMid).toBe('');
    expect(parsed?.init.sdpMLineIndex).toBe(0);
  });

  it('字段类型不对时退回默认值，而不是把脏数据传给浏览器', () => {
    const parsed = parseCandidate({
      pc: 'pub', candidate: 'candidate:x', sdp_mid: 7, sdp_mline_index: 'no',
    });
    expect(parsed?.pc).toBe('pub');
    expect(parsed?.init.sdpMid).toBe('');
    expect(parsed?.init.sdpMLineIndex).toBe(0);
  });
});
