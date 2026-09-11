import { describe, expect, it } from 'vitest';

import { ErrorCode, RtcError } from '../src/errors.js';
import type { MediaSource } from '../src/media/mediaAdapter.js';
import { WebRTCAdapter } from '../src/media/webrtcAdapter.js';

/*
  本端预览单飞。

  守的是「来电页预览还没起完就点接听」这条路：接听要探摄像头权限、要起预览、进房后还要发布，
  三处各自去 getUserMedia 就是把摄像头开两三次——多出来的那条流没人收，指示灯灭不掉。
  所以**正在起的那一次必须被所有人共用**，而 close() 之后回来的那条流必须当场放掉。
*/

interface FakeTrack {
  readonly id: string;
  readonly kind: string;
  enabled: boolean;
  stopped: boolean;
  stop(): void;
}

/**
 * DeferredSource 是可以手动放行的取流源。每次 getStream 记一笔，直到 `resolveNext` 才返回。
 *
 * 计数用数组：返回对象时 number 按值拷贝，外面那份永远是 0（见 simulcast.test.ts 的教训）。
 */
function deferredSource(): {
  source: MediaSource;
  requests: MediaStreamConstraints[];
  tracks: FakeTrack[];
  resolveNext: () => void;
  rejectNext: (err: Error) => void;
} {
  const requests: MediaStreamConstraints[] = [];
  const tracks: FakeTrack[] = [];
  const pending: { resolve: (s: MediaStream) => void; reject: (e: Error) => void }[] = [];
  const source: MediaSource = {
    getStream: (constraints) => {
      requests.push(constraints);
      return new Promise<MediaStream>((resolve, reject) => pending.push({ resolve, reject }));
    },
  };
  const resolveNext = (): void => {
    const track: FakeTrack = {
      id: `cam-${tracks.length + 1}`, kind: 'video', enabled: true, stopped: false,
      stop() { this.stopped = true; },
    };
    tracks.push(track);
    // 只实现适配器用到的那几个方法；MediaStream 在 node 环境里不存在。
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    pending.shift()?.resolve(stream);
  };
  const rejectNext = (err: Error): void => pending.shift()?.reject(err);
  return { source, requests, tracks, resolveNext, rejectNext };
}

/** tick 让排队的微任务跑完：getStream 是在 await 链的中间被调到的。 */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('本端预览单飞', () => {
  it('两次并发的 startLocalPreview 只开一次摄像头，拿到同一个 cid', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    const first = adapter.startLocalPreview();
    const second = adapter.startLocalPreview();
    await tick();
    fake.resolveNext();
    const [a, b] = await Promise.all([first, second]);
    expect(fake.requests).toHaveLength(1);
    expect(a.cid).toBe('cam-1');
    expect(b.cid).toBe('cam-1');
  });

  it('预览没起完就 acquireCamera（点了接听）：共用那一次，并且照常挂到 pub 上', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    const added: string[] = [];
    const sender = { getParameters: () => ({ encodings: [] }), setParameters: async () => undefined };
    Reflect.set(adapter, 'pub', {
      addTransceiver: (track: MediaStreamTrack) => { added.push(track.id); return { sender }; },
      addTrack: (track: MediaStreamTrack) => { added.push(track.id); return sender; },
      close: () => undefined,
    });
    const preview = adapter.startLocalPreview();
    const publish = adapter.acquireCamera(true);
    await tick();
    fake.resolveNext();
    await Promise.all([preview, publish]);
    expect(fake.requests).toHaveLength(1);
    expect(added).toEqual(['cam-1']);
  });

  it('预览在起时 probeCamera 不再自己开一次，等那一次的结果', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    const preview = adapter.startLocalPreview();
    await tick();
    const probe = adapter.probeCamera();
    await tick();
    fake.resolveNext();
    await Promise.all([preview, probe]);
    expect(fake.requests).toHaveLength(1);
    // 探测没把预览那条轨道停掉：它正在被用着。
    expect(fake.tracks[0]?.stopped).toBe(false);
  });

  it('起到一半 close()：迟到的流当场放掉，那次调用报错；之后重新起是一次新的取流', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    const stale = adapter.startLocalPreview();
    await tick();
    adapter.close();
    const fresh = adapter.startLocalPreview();
    await tick();
    expect(fake.requests).toHaveLength(2);

    fake.resolveNext();
    await expect(stale).rejects.toMatchObject({ code: ErrorCode.invalidState });
    expect(fake.tracks[0]?.stopped).toBe(true);

    fake.resolveNext();
    expect((await fresh).cid).toBe('cam-2');
    expect(fake.tracks[1]?.stopped).toBe(false);
    // 上一代的收尾不能抹掉这一代的预览：再要一次直接复用，不再取流。
    expect((await adapter.startLocalPreview()).cid).toBe('cam-2');
    expect(fake.requests).toHaveLength(2);
  });

  it('取流失败会放开单飞：下一次还能重试（用户去设置里开了权限再点）', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    const failing = adapter.startLocalPreview();
    await tick();
    const denied = new Error('denied');
    denied.name = 'NotAllowedError';
    fake.rejectNext(denied);
    await expect(failing).rejects.toBeInstanceOf(RtcError);

    const retry = adapter.startLocalPreview();
    await tick();
    fake.resolveNext();
    expect((await retry).cid).toBe('cam-1');
    expect(fake.requests).toHaveLength(2);
  });
});
