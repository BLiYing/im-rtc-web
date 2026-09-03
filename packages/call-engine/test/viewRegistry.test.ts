import { beforeAll, describe, expect, it } from 'vitest';

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
