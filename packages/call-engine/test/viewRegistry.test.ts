import { beforeAll, describe, expect, it } from 'vitest';

import type { MediaAdapter } from '../src/media/mediaAdapter.js';
import { MediaBridge } from '../src/media/mediaBridge.js';
import { ViewRegistry } from '../src/media/viewRegistry.js';
import { camelizeArgs, snakeToCamel, toFrameProps } from '../src/signaling/caseMapping.js';

/**
 * ViewRegistry 的用例集中在**一个时序陷阱**上：
 * 轨道到达（`ontrack`，第一个 RTP 包时触发）与「知道它是谁的」（信令帧）
 * 是两条独立的时间线，谁先到都可能。先到的那一半没被记住，
 * 表现就是「有声音没画面」，而且只在网络较快时偶发——最难查的那一类。
 */

/** Node 里没有 MediaStream，用最小替身：只要能加/删/列轨道就够。 */
class FakeStream {
  private tracks: { id: string }[] = [];
  addTrack(t: { id: string }): void {
    this.tracks.push(t);
  }
  removeTrack(t: { id: string }): void {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
  getTracks(): { id: string }[] {
    return this.tracks;
  }
}

function fakeTrack(id: string): MediaStreamTrack {
  // 只用到 id；断言也只看 id，所以断言成 MediaStreamTrack 是安全的。
  return { id } as MediaStreamTrack;
}

function trackIds(stream: MediaStream | undefined): string[] {
  return (stream?.getTracks() ?? []).map((t) => t.id);
}

beforeAll(() => {
  (globalThis as { MediaStream?: unknown }).MediaStream = FakeStream;
});

describe('MediaBridge.refreshLocalViews', () => {
  it('本端轨道换了人（通话中关了又开）就换挂新轨道；轨道没了（进房前关掉）就摘掉；没变不动', () => {
    const locals = new Map<string, MediaStreamTrack>([['cam-1', fakeTrack('cam-1')]]);
    const adapter = { localTrack: (cid: string) => locals.get(cid) } as unknown as MediaAdapter;
    const bridge = new MediaBridge(adapter);
    const el = { srcObject: null as MediaStream | null };
    bridge.attachLocalView('cam-1', el);
    expect(trackIds(el.srcObject ?? undefined)).toEqual(['cam-1']);

    const before = el.srcObject;
    bridge.refreshLocalViews();
    expect(el.srcObject, '轨道没变：不该重挂，<video> 会闪').toBe(before);

    locals.set('cam-1', fakeTrack('cam-2'));
    bridge.refreshLocalViews();
    expect(trackIds(el.srcObject ?? undefined)).toEqual(['cam-2']);
    expect(el.srcObject, '要是一条新流，<video> 才会重新加载').not.toBe(before);

    locals.delete('cam-1');
    bridge.refreshLocalViews();
    expect(el.srcObject).toBeNull();
  });
});

describe('ViewRegistry 的挂载时序', () => {
  it('归属先到、轨道后到：直接挂上', () => {
    const reg = new ViewRegistry();
    const el = { srcObject: null as MediaStream | null };
    reg.attach('alice', el);
    reg.addTrack('t-1', fakeTrack('t-1'), 'alice');

    expect(trackIds(el.srcObject ?? undefined)).toEqual(['t-1']);
  });

  it('轨道先到、归属后到：认领时补挂', () => {
    const reg = new ViewRegistry();
    const el = { srcObject: null as MediaStream | null };
    reg.attach('alice', el);

    reg.addTrack('t-1', fakeTrack('t-1'), ''); // 还不知道是谁的
    expect(el.srcObject).toBeNull();

    reg.claim('t-1', 'alice');
    expect(trackIds(el.srcObject ?? undefined)).toEqual(['t-1']);
  });

  it('元素后挂：已经收到的轨道要补上去', () => {
    const reg = new ViewRegistry();
    reg.addTrack('t-1', fakeTrack('t-1'), 'alice');

    const el = { srcObject: null as MediaStream | null };
    reg.attach('alice', el);
    expect(trackIds(el.srcObject ?? undefined)).toEqual(['t-1']);
  });

  it('音视频合到同一条流上（浏览器才会同步播放）', () => {
    const reg = new ViewRegistry();
    const el = { srcObject: null as MediaStream | null };
    reg.attach('alice', el);
    reg.addTrack('t-a', fakeTrack('t-a'), 'alice');
    reg.addTrack('t-v', fakeTrack('t-v'), 'alice');

    expect(trackIds(el.srcObject ?? undefined)).toEqual(['t-a', 't-v']);
  });

  it('摘轨道只影响那一个人', () => {
    const reg = new ViewRegistry();
    const alice = { srcObject: null as MediaStream | null };
    const bob = { srcObject: null as MediaStream | null };
    reg.attach('alice', alice);
    reg.attach('bob', bob);
    reg.addTrack('t-1', fakeTrack('t-1'), 'alice');
    reg.addTrack('t-2', fakeTrack('t-2'), 'bob');

    reg.removeTrack('t-1');
    expect(alice.srcObject).toBeNull(); // 没轨道了就该断开，不留一条空流
    expect(trackIds(bob.srcObject ?? undefined)).toEqual(['t-2']);
  });

  it('卸载要真的清掉 srcObject，否则解码器还占着', () => {
    const reg = new ViewRegistry();
    const el = { srcObject: null as MediaStream | null };
    reg.attach('alice', el);
    reg.addTrack('t-1', fakeTrack('t-1'), 'alice');

    reg.attach('alice', null);
    expect(el.srcObject).toBeNull();
  });

  it('clear 把所有挂载都断开', () => {
    const reg = new ViewRegistry();
    const el = { srcObject: null as MediaStream | null };
    reg.attach('alice', el);
    reg.addTrack('t-1', fakeTrack('t-1'), 'alice');

    reg.clear();
    expect(el.srcObject).toBeNull();
    expect(reg.streamFor('alice')).toBeUndefined();
  });
});

describe('snake_case ↔ camelCase', () => {
  it('转换事件参数名', () => {
    expect(snakeToCamel('media_type')).toBe('mediaType');
    expect(snakeToCamel('uid')).toBe('uid');
    expect(camelizeArgs({ call_id: 'c-1', duration_sec: 3 })).toEqual({
      callId: 'c-1',
      durationSec: 3,
    });
  });

  it('帧字段两种键都认', () => {
    const fields = {
      trackId: { wire: 'track_id', type: 'string' },
      maxLayer: { wire: 'max_layer', type: 'string' },
    } as const;
    expect(toFrameProps(fields, { track_id: 't-1', max_layer: 'l' })).toEqual({
      trackId: 't-1',
      maxLayer: 'l',
    });
    expect(toFrameProps(fields, { trackId: 't-1' })).toEqual({ trackId: 't-1' });
  });
});

/**
 * `firstVideoFrame` 的判据必须是「轨道真的出数据」，不是「轨道协商完了」。
 *
 * 远端轨道刚 `ontrack` 时 `muted === true`，要等第一个 RTP 包到达才 `unmute`。
 * 在 ontrack 那一刻就抛「首帧到达」，UI 会提前撤掉 loading 然后露出黑屏——
 * 正是这个事件要避免的那件事。
 */
describe('MediaBridge 的首帧判据', () => {
  /** FakeTrack 模拟远端轨道的 muted → unmute 过程。 */
  class FakeTrack {
    readonly kind = 'video';
    muted = true;
    private listeners: (() => void)[] = [];
    constructor(readonly id: string) {}
    addEventListener(name: string, fn: () => void): void {
      if (name === 'unmute') this.listeners.push(fn);
    }
    /** deliverFirstPacket 模拟第一个 RTP 包到达。 */
    deliverFirstPacket(): void {
      this.muted = false;
      for (const fn of this.listeners.splice(0)) fn();
    }
  }

  const asTrack = (t: FakeTrack): MediaStreamTrack => t as unknown as MediaStreamTrack;

  it('协商完还没出数据时不抛，出数据之后才抛', () => {
    const bridge = new MediaBridge(stubAdapter());
    const fired: string[] = [];
    const track = new FakeTrack('t-1');

    bridge.addRemoteTrack('t-1', asTrack(track), 'alice', (id) => fired.push(id));
    expect(fired, '轨道还 muted 着，不该抛首帧').toEqual([]);

    track.deliverFirstPacket();
    expect(fired).toEqual(['t-1']);
  });

  it('已经在出数据的轨道立刻抛，不等一个不会再来的事件', () => {
    const bridge = new MediaBridge(stubAdapter());
    const fired: string[] = [];
    const track = new FakeTrack('t-2');
    track.muted = false;

    bridge.addRemoteTrack('t-2', asTrack(track), 'alice', (id) => fired.push(id));
    expect(fired).toEqual(['t-2']);
  });

  it('同一条轨道只抛一次', () => {
    const bridge = new MediaBridge(stubAdapter());
    const fired: string[] = [];
    const track = new FakeTrack('t-3');

    bridge.addRemoteTrack('t-3', asTrack(track), 'alice', (id) => fired.push(id));
    bridge.addRemoteTrack('t-3', asTrack(track), 'alice', (id) => fired.push(id));
    track.deliverFirstPacket();
    expect(fired).toEqual(['t-3']);
  });
});

/** stubAdapter 是 MediaBridge 用不到的那部分适配器接口的空壳。 */
describe('MediaBridge 与状态机对账（syncRemoteTracks）', () => {
  /*
    这一组守的是原先整条缺失的**摘除**那一半：`ViewRegistry.removeTrack` 曾经只有测试
    在调，生产路径一次都没接。后果是对方关掉摄像头（`room.track_unpublished`）或直接
    离房之后，那条已经不存在的轨道仍然挂在他的 MediaStream 上、仍然绑在 `<video>` 上：
    自画 UI 的宿主看到一帧冻住的画面，反复开关摄像头还会让废轨道越堆越多。
  */
  const owner = (uid: string): { uid: string } => ({ uid });

  it('状态机里已经没有的远端轨道要摘掉', () => {
    const bridge = new MediaBridge(stubAdapter());
    const el = { srcObject: null as MediaStream | null };
    bridge.attachView('alice', el);
    bridge.addRemoteTrack('t-1', fakeTrack('t-1'), 'alice', () => undefined);
    bridge.syncRemoteTracks({ 't-1': owner('alice') });
    expect(trackIds(el.srcObject ?? undefined)).toEqual(['t-1']);

    // 对方 unpublish：状态机的表里没有它了。
    bridge.syncRemoteTracks({});
    expect(el.srcObject, '轨道没了就该断开，不留一帧冻住的画面').toBeNull();
  });

  it('还没认领的轨道不参与对账——那正是「轨道先到、归属后到」', () => {
    const bridge = new MediaBridge(stubAdapter());
    const el = { srcObject: null as MediaStream | null };
    bridge.attachView('alice', el);

    // ontrack 先到，track_published 还没来：这时它不在 remoteTracks 里。
    bridge.addRemoteTrack('t-1', fakeTrack('t-1'), '', () => undefined);
    bridge.syncRemoteTracks({}); // 按对账扫的话会在这里把它当场摘掉
    bridge.syncRemoteTracks({ 't-1': owner('alice') }); // 归属到了

    expect(trackIds(el.srcObject ?? undefined), '认领机制不能被对账打断').toEqual(['t-1']);
  });

  it('本端预览不归房间管，对账扫不到它', () => {
    const track = fakeTrack('cam-1');
    const adapter = { ...stubAdapter(), localTrack: (): MediaStreamTrack => track };
    const bridge = new MediaBridge(adapter);
    const el = { srcObject: null as MediaStream | null };

    bridge.attachLocalView('cam-1', el);
    expect(trackIds(el.srcObject ?? undefined)).toEqual(['cam-1']);

    // 拨出中一次 dispatch：房间还是空的，本端预览不能被顺手摘掉。
    bridge.syncRemoteTracks({});
    expect(trackIds(el.srcObject ?? undefined), '自拍小窗不该被房间对账清掉').toEqual(['cam-1']);
  });
});

function stubAdapter(): MediaAdapter {
  const notUsed = (): never => {
    throw new Error('这条用例不该走到媒体适配器');
  };
  return {
    open: (): void => {},
    close: (): void => {},
    acquireMicrophone: notUsed,
    startLocalPreview: notUsed,
    acquireCamera: notUsed,
    createPubOffer: notUsed,
    restartPubICE: (): void => {},
    applyPubAnswer: notUsed,
    answerSubOffer: notUsed,
    addRemoteCandidate: notUsed,
    setMuted: (): void => {},
    localTrack: (): undefined => undefined,
  };
}
