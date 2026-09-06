import { describe, expect, it } from 'vitest';

import { CallEngine } from '../src/engine.js';
import { parseCandidate } from '../src/signaling/candidate.js';
import type { LocalTrackInfo, MediaAdapter, MediaAdapterEvents } from '../src/media/mediaAdapter.js';
import type { PcRole } from '../src/signaling/enums.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';

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

  open(events: MediaAdapterEvents): void {
    this.events = events;
  }
  async acquireMicrophone(): Promise<LocalTrackInfo> {
    return { cid: 'mic-1', kind: 'audio', source: 'microphone' };
  }
  async probeMicrophone(): Promise<void> {}
  async startLocalPreview(): Promise<LocalTrackInfo> {
    return this.acquireCamera();
  }

  async acquireCamera(): Promise<LocalTrackInfo> {
    return { cid: 'cam-1', kind: 'video', source: 'camera' };
  }
  async createPubOffer(): Promise<string> {
    return 'offer-sdp';
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

async function setup(): Promise<{ engine: CallEngine; media: RecordingMedia; ws: FakeWebSocket }> {
  const media = new RecordingMedia();
  let ws: FakeWebSocket | undefined;
  const engine = new CallEngine({
    url: 'ws://test/v1/ws',
    deviceId: 'd1',
    media,
    webSocketFactory: () => {
      const socket = new FakeWebSocket();
      ws = socket;
      queueMicrotask(() => socket.open());
      return socket;
    },
  });

  const login = engine.login('token');
  await flush(6);
  const socket = ws;
  if (socket === undefined) throw new Error('没有建立连接');
  const hello = socket.lastFrame();
  socket.receive(JSON.stringify({
    type: 'sys.hello.ok', req_id: hello?.req_id ?? '', ts: 1, data: HELLO_OK_DATA,
  }));
  await login;
  return { engine, media, ws: socket };
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
