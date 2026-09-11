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

/** withPub 塞一条假的 pub：记下挂上去的轨道，以及 `replaceTrack` 换上去的轨道。 */
function withPub(adapter: WebRTCAdapter): { added: string[]; replaced: string[] } {
  const added: string[] = [];
  const replaced: string[] = [];
  const sender = {
    getParameters: () => ({ encodings: [] }),
    setParameters: async () => undefined,
    replaceTrack: async (track: MediaStreamTrack | null) => { replaced.push(track?.id ?? 'null'); },
  };
  Reflect.set(adapter, 'pub', {
    addTransceiver: (track: MediaStreamTrack) => { added.push(track.id); return { sender }; },
    addTrack: (track: MediaStreamTrack) => { added.push(track.id); return sender; },
    close: () => undefined,
  });
  return { added, replaced };
}

/** published 把摄像头推到「已发布」：cam-1 挂在 pub 上。 */
async function published(
  fake: ReturnType<typeof deferredSource>, adapter: WebRTCAdapter,
): Promise<{ added: string[]; replaced: string[] }> {
  const pub = withPub(adapter);
  const publish = adapter.acquireCamera(true);
  await tick();
  fake.resolveNext();
  await publish;
  return pub;
}

/*
  进房前关摄像头 = 真的停采集（交互稿 §01 v3.7）。

  只把按钮熄掉的话，来电页 / 拨出中开过又关掉的摄像头，指示灯要一直亮到通话结束。
  难点全在并发：关的那一下可能落在预览正在起、正在被接听发布、或者紧接着又被打开的时候——
  **以最新意图为准**，并且已经发布的那条绝不能被这里停掉。
*/
describe('进房前关摄像头：真的停采集', () => {
  it('预览起好之后关掉：轨道 stop、取不到了；再打开是一次新的取流、新的 cid', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    const first = adapter.startLocalPreview();
    await tick();
    fake.resolveNext();
    expect((await first).cid).toBe('cam-1');

    await adapter.stopLocalPreview();
    expect(fake.tracks[0]?.stopped).toBe(true);
    expect(adapter.localTrack('cam-1')).toBeUndefined();

    const again = adapter.startLocalPreview();
    await tick();
    fake.resolveNext();
    expect((await again).cid).toBe('cam-2');
    expect(fake.requests).toHaveLength(2);
  });

  it('预览还在起时关掉：等它起完再停，不留一条没人管的流', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    const preview = adapter.startLocalPreview();
    await tick();
    const stop = adapter.stopLocalPreview();
    fake.resolveNext();
    await Promise.all([preview, stop]);
    expect(fake.tracks[0]?.stopped).toBe(true);
    expect(adapter.localTrack('cam-1')).toBeUndefined();
  });

  it('关了又马上打开（前一次还在起）：最新意图为准——不停，也不重开', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    const preview = adapter.startLocalPreview();
    await tick();
    const stop = adapter.stopLocalPreview();
    const reopen = adapter.startLocalPreview();
    fake.resolveNext();
    await Promise.all([preview, stop]);
    expect((await reopen).cid).toBe('cam-1');
    expect(fake.tracks[0]?.stopped).toBe(false);
    expect(fake.requests).toHaveLength(1);
  });

  it('接听正在发布这条预览时再关：不停——已发布的归 setMuted 管', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    const { added } = withPub(adapter);
    const preview = adapter.startLocalPreview();
    await tick();
    const publish = adapter.acquireCamera(true);
    const stop = adapter.stopLocalPreview();
    fake.resolveNext();
    await Promise.all([preview, publish, stop]);
    expect(added).toEqual(['cam-1']);
    expect(fake.tracks[0]?.stopped).toBe(false);
    expect(adapter.localTrack('cam-1')?.id).toBe('cam-1');
  });

  it('没有预览时关：什么也不做，也不去取流', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    await adapter.stopLocalPreview();
    expect(fake.requests).toHaveLength(0);
  });
});

/*
  通话中关摄像头也停采集（本批延后项 1）。

  `enabled=false` 画面是黑了，指示灯却一直亮。关 = stop 轨道；开 = 重新取流、`replaceTrack`
  换到原来的 sender 上——cid、transceiver 都不变，**不重新协商**。
*/
describe('通话中关摄像头：停采集，打开时换上新轨道', () => {
  it('关 = stop；开 = 重新取流并 replaceTrack，cid 不变，localTrack 换成新的', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    const { added, replaced } = await published(fake, adapter);

    await adapter.setMuted('cam-1', true);
    expect(fake.tracks[0]?.stopped).toBe(true);
    expect(fake.requests).toHaveLength(1);

    const reopen = adapter.setMuted('cam-1', false);
    await tick();
    fake.resolveNext();
    await reopen;
    expect(fake.requests).toHaveLength(2);
    expect(replaced).toEqual(['cam-2']);
    expect(added, '不能再挂一条 transceiver：那是重协商').toEqual(['cam-1']);
    expect(adapter.localTrack('cam-1')?.id).toBe('cam-2');
    expect(fake.tracks[1]?.stopped).toBe(false);
  });

  it('重新取流被拒：以 RtcError 失败、什么也没换上；之后再开还能成功', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    const { replaced } = await published(fake, adapter);
    await adapter.setMuted('cam-1', true);

    const denied = adapter.setMuted('cam-1', false);
    await tick();
    const err = new Error('denied');
    err.name = 'NotAllowedError';
    fake.rejectNext(err);
    await expect(denied).rejects.toBeInstanceOf(RtcError);
    expect(replaced).toEqual([]);

    const retry = adapter.setMuted('cam-1', false);
    await tick();
    fake.resolveNext();
    await retry;
    expect(replaced).toEqual(['cam-2']);
  });

  it('关 → 开 → 关 连点：按顺序落地，最后停着，刚换上去的那条也被停掉', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    await published(fake, adapter);
    await adapter.setMuted('cam-1', true);

    const on = adapter.setMuted('cam-1', false);
    const off = adapter.setMuted('cam-1', true);
    await tick();
    fake.resolveNext();
    await Promise.all([on, off]);
    expect(fake.requests).toHaveLength(2);
    expect(fake.tracks[1]?.stopped).toBe(true);
  });

  it('重新取流还没回来就 close()：迟到的流当场放掉，不换上去', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    const { replaced } = await published(fake, adapter);
    await adapter.setMuted('cam-1', true);

    const on = adapter.setMuted('cam-1', false);
    await tick();
    adapter.close();
    fake.resolveNext();
    await on;
    expect(fake.tracks[1]?.stopped).toBe(true);
    expect(replaced).toEqual([]);
  });

  it('麦克风静音不碰摄像头的采集', async () => {
    const fake = deferredSource();
    const adapter = new WebRTCAdapter(fake.source);
    await published(fake, adapter);
    await adapter.setMuted('mic-unknown', true);
    expect(fake.tracks[0]?.stopped).toBe(false);
  });
});
