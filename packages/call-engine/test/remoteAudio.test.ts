import { describe, expect, it, vi } from 'vitest';

import { MediaBridge } from '../src/media/mediaBridge.js';
import type { AudioSink } from '../src/media/remoteAudio.js';
import { RemoteAudioPlayer } from '../src/media/remoteAudio.js';
import { UnsubscribeTimers } from '../src/state/unsubscribeTimers.js';
import { NullMedia } from './nullMedia.js';

/**
 * 远端音频由引擎自己播（MEETING_ROOM_DESIGN §8 #10 / §9 ②）。
 *
 * 这是 2.0.0 的一处行为变化：`attachView` 从此只管画面。没有它，会议翻页之后
 * **不在本页的二十几个人说话谁也听不见**——那正是 M2 验收里 Web 要重点验的一条。
 */

/** FakeSink 是一个记账用的播放出口替身（node 环境没有 DOM）。 */
class FakeSink implements AudioSink {
  srcObject: MediaProvider | null = null;
  autoplay = false;
  muted = false;
  plays = 0;
  removed = 0;
  /** 头一次 play 失败，模拟浏览器的自动播放限制。 */
  failFirstPlay = false;

  async play(): Promise<void> {
    this.plays += 1;
    if (this.failFirstPlay && this.plays === 1) throw new Error('NotAllowedError');
  }

  remove(): void {
    this.removed += 1;
  }
}

function fakeTrack(id: string, kind: 'audio' | 'video'): MediaStreamTrack {
  return { id, kind } as unknown as MediaStreamTrack;
}

describe('RemoteAudioPlayer', () => {
  it('每条音频轨一个出口，收下就播', async () => {
    const sinks: FakeSink[] = [];
    const player = new RemoteAudioPlayer(() => {
      const sink = new FakeSink();
      sinks.push(sink);
      return sink;
    });

    player.add('t-1', fakeTrack('t-1', 'audio'));
    player.add('t-2', fakeTrack('t-2', 'audio'));
    await Promise.resolve();

    expect(player.count).toBe(2);
    expect(sinks.map((s) => s.plays)).toEqual([1, 1]);
  });

  it('同一条轨道重复 add 是幂等的', () => {
    let built = 0;
    const player = new RemoteAudioPlayer(() => {
      built += 1;
      return new FakeSink();
    });
    player.add('t-1', fakeTrack('t-1', 'audio'));
    player.add('t-1', fakeTrack('t-1', 'audio'));
    expect(built).toBe(1);
  });

  it('remove 会断开 srcObject 并把元素摘掉', () => {
    const sink = new FakeSink();
    const player = new RemoteAudioPlayer(() => sink);
    player.add('t-1', fakeTrack('t-1', 'audio'));
    player.remove('t-1');
    expect(player.count).toBe(0);
    expect(sink.srcObject).toBeNull();
    expect(sink.removed).toBe(1);
  });

  it('自动播放被挡时不往上抛，unlock 再试一次', async () => {
    const sink = new FakeSink();
    sink.failFirstPlay = true;
    const player = new RemoteAudioPlayer(() => sink);

    // 这一句不许抛：宿主对「还没有用户手势」无事可做。
    player.add('t-1', fakeTrack('t-1', 'audio'));
    await Promise.resolve();
    expect(sink.plays).toBe(1);

    player.unlock();
    expect(sink.plays).toBe(2);
  });

  it('没有 DOM（node 环境）时安静降级，不崩', () => {
    const player = new RemoteAudioPlayer();
    player.add('t-1', fakeTrack('t-1', 'audio'));
    expect(player.count).toBe(0);
  });
});

describe('MediaBridge：音频归引擎播，画面归 attachView', () => {
  function bridgeWithSinks(): { bridge: MediaBridge; sinks: FakeSink[] } {
    const sinks: FakeSink[] = [];
    const bridge = new MediaBridge(new NullMedia(), () => {
      const sink = new FakeSink();
      sinks.push(sink);
      return sink;
    });
    return { bridge, sinks };
  }

  it('音频轨一到就播，**不等认领 uid**', () => {
    const { bridge, sinks } = bridgeWithSinks();
    // uid 传空 = `ontrack` 比 `room.track_published` 先到，这是常态。
    bridge.addRemoteTrack('t-a', fakeTrack('t-a', 'audio'), '', () => {});
    expect(sinks.length, '认领不到 uid 也要出声').toBe(1);
  });

  it('对账摘掉一条轨道时，它的播放出口也跟着关', () => {
    const { bridge, sinks } = bridgeWithSinks();
    bridge.addRemoteTrack('t-a', fakeTrack('t-a', 'audio'), 'bob', () => {});
    bridge.syncRemoteTracks({});
    expect(sinks[0]?.removed).toBe(1);
  });

  it('unlockRemoteAudio 把全部出口再播一遍', () => {
    const { bridge, sinks } = bridgeWithSinks();
    bridge.addRemoteTrack('t-a', fakeTrack('t-a', 'audio'), 'bob', () => {});
    const before = sinks[0]?.plays ?? 0;
    bridge.unlockRemoteAudio();
    expect(sinks[0]?.plays).toBe(before + 1);
  });
});

describe('UnsubscribeTimers：按清单对账，不按来路各排各撤', () => {
  it('清单里新增的排上，移走的撤掉', () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const timers = new UnsubscribeTimers((trackId) => fired.push(trackId));

    timers.sync(['t-1', 't-2']);
    expect(timers.armed).toBe(2);

    // t-1 翻回来了：它的定时器要撤掉，否则五秒后画面会突然没。
    timers.sync(['t-2']);
    expect(timers.armed).toBe(1);

    vi.advanceTimersByTime(5_000);
    expect(fired).toEqual(['t-2']);
    expect(timers.armed, '到点的那只要自己摘掉').toBe(0);
    vi.useRealTimers();
  });

  it('已经排着的不重排——重排会让五秒一直续下去', () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const timers = new UnsubscribeTimers((trackId) => fired.push(trackId));

    timers.sync(['t-1']);
    vi.advanceTimersByTime(4_000);
    timers.sync(['t-1']); // 又一轮状态推进，清单没变
    vi.advanceTimersByTime(1_000);

    expect(fired).toEqual(['t-1']);
    vi.useRealTimers();
  });

  it('clear 撤掉全部（离房、logout）', () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const timers = new UnsubscribeTimers((trackId) => fired.push(trackId));
    timers.sync(['t-1', 't-2']);
    timers.clear();
    vi.advanceTimersByTime(10_000);
    expect(fired).toEqual([]);
    vi.useRealTimers();
  });
});
