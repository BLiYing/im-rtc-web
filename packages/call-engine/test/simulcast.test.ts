import { describe, expect, it } from 'vitest';

import { WebRTCAdapter } from '../src/media/webrtcAdapter.js';
import { VideoProfiles, simulcastEncodings } from '../src/media/videoProfile.js';

/*
  上行 simulcast。

  这里守的是一个**信令说了、媒体面没做**的洞：`publishCamera(simulcast = true)`
  一路把这一位传进了 `room.publish` 帧、告诉服务端「我有三层」，可媒体面走的是裸
  `addTrack`——那只会产生一个 encoding。服务端于是只看到空 RID 的单层，
  订阅者报 `l` 也只能收到全速率的 h（`selectLayer` 的兜底），
  弱下行的那一方被自己的全速率流压死。

  两侧都要钉：encodings 本身的形状，以及**发布时真的走了 addTransceiver**。
*/

describe('上行 simulcast 的编码参数', () => {
  /*
    服务端直接拿 RID 当层名（internal/sfu/layer.go 的 ridToLayer），不做映射表。
    拼错一个字母就会被当成「空 RID = 单层」，三层全被认成 h，层选择彻底失效且不报错。
  */
  it('rid 恰好是 l / m / h，顺序由低到高', () => {
    expect(simulcastEncodings(VideoProfiles.p720).map((e) => e.rid)).toEqual(['l', 'm', 'h']);
  });

  it('h 不缩放，m 减半，l 四分之一', () => {
    expect(simulcastEncodings(VideoProfiles.p720).map((e) => e.scaleResolutionDownBy)).toEqual([
      4, 2, 1,
    ]);
  });

  /*
    三层各有各的码率。全设成 h 的目标值等于让 l / m 也按 1.5Mbps 发，
    上行涨到三倍而降层根本省不下带宽。折算比例沿用 VideoProfile 的注释：m 取 1/3、l 取 1/10。
  */
  it('码率按 1 / (1/3) / (1/10) 折算，不是三层同值', () => {
    const rates = simulcastEncodings(VideoProfiles.p720).map((e) => e.maxBitrate);
    expect(rates).toEqual([150_000, 500_000, 1_500_000]);
    expect(new Set(rates).size).toBe(3);
  });

  it('换档位时三层跟着换', () => {
    const rates = simulcastEncodings(VideoProfiles.p360).map((e) => e.maxBitrate);
    expect(rates).toEqual([50_000, Math.round(500_000 / 3), 500_000]);
  });
});

/**
 * fakePeer 记下 addTransceiver / addTrack 各被怎么调用。
 *
 * 计数用**数组**而不是 number：返回对象时数字是按值拷的，之后再自增
 * 外面那份永远是 0（第一版就这么写，结果用例假红了一次）。
 */
function fakePeer(): {
  pc: RTCPeerConnection;
  transceivers: RTCRtpTransceiverInit[];
  addTrackCalls: string[];
} {
  const transceivers: RTCRtpTransceiverInit[] = [];
  const addTrackCalls: string[] = [];
  const sender = {
    getParameters: () => ({ encodings: [] as RTCRtpEncodingParameters[] }),
    setParameters: async () => undefined,
  };
  const pc = {
    addTransceiver: (_track: MediaStreamTrack, init: RTCRtpTransceiverInit) => {
      transceivers.push(init);
      return { sender };
    },
    addTrack: (track: MediaStreamTrack) => {
      addTrackCalls.push(track.id);
      return sender;
    },
    addEventListener: () => undefined,
    close: () => undefined,
  } as unknown as RTCPeerConnection;
  return { pc, transceivers, addTrackCalls };
}

/** 一条最小的假视频轨道；只要 id 与 kind 就够走通发布路径。 */
function fakeTrack(id: string, kind: 'video' | 'audio'): MediaStreamTrack {
  return { id, kind, enabled: true, stop: () => undefined } as unknown as MediaStreamTrack;
}

describe('发布视频时真的走了 addTransceiver', () => {
  /*
    **这条是整个洞的要害**：走 addTrack 就只有一个 encoding，
    协商之后再 setParameters 也加不出层来（规范不允许改 encoding 的条数）。
    所以必须在建 transceiver 那一刻就把 sendEncodings 给出去。
  */
  it('simulcast=true 时用 addTransceiver 带上三层，不走 addTrack', () => {
    const adapter = new WebRTCAdapter();
    const peer = fakePeer();
    // 直接驱动私有的发布路径：这里要验的就是它选了哪个浏览器 API。
    const addVideoTrack = Reflect.get(adapter, 'addVideoTrack') as (
      t: MediaStreamTrack,
      s: MediaStream,
      simulcast: boolean,
    ) => void;
    Reflect.set(adapter, 'pub', peer.pc);

    addVideoTrack.call(
      adapter,
      fakeTrack('cid-1', 'video'),
      { id: 'stream-1' } as unknown as MediaStream,
      true,
    );

    expect(peer.addTrackCalls).toEqual([]);
    expect(peer.transceivers).toHaveLength(1);
    const init = peer.transceivers[0];
    expect(init?.direction).toBe('sendonly');
    expect(init?.sendEncodings?.map((e) => e.rid)).toEqual(['l', 'm', 'h']);
  });

  /*
    msid 的第二段就是 cid，服务端靠它认领 m-line（协议 §3.2）。
    省掉 streams 服务端永远认不回这条轨道——上行接进来了却没人要。
  */
  it('带上 streams，否则服务端认不回 cid', () => {
    const adapter = new WebRTCAdapter();
    const peer = fakePeer();
    const addVideoTrack = Reflect.get(adapter, 'addVideoTrack') as (
      t: MediaStreamTrack,
      s: MediaStream,
      simulcast: boolean,
    ) => void;
    Reflect.set(adapter, 'pub', peer.pc);
    const stream = { id: 'stream-1' } as unknown as MediaStream;

    addVideoTrack.call(adapter, fakeTrack('cid-1', 'video'), stream, true);

    expect(peer.transceivers[0]?.streams).toEqual([stream]);
  });

  /** 明确关掉 simulcast（屏幕共享就是这么发的）时退回单层。 */
  it('simulcast=false 时退回 addTrack 单层', () => {
    const adapter = new WebRTCAdapter();
    const peer = fakePeer();
    const addVideoTrack = Reflect.get(adapter, 'addVideoTrack') as (
      t: MediaStreamTrack,
      s: MediaStream,
      simulcast: boolean,
    ) => void;
    Reflect.set(adapter, 'pub', peer.pc);

    addVideoTrack.call(
      adapter,
      fakeTrack('cid-1', 'video'),
      { id: 'stream-1' } as unknown as MediaStream,
      false,
    );

    expect(peer.transceivers).toHaveLength(0);
    expect(peer.addTrackCalls).toEqual(['cid-1']);
  });
});
