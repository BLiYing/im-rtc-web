import { logger } from '../logger.js';

/**
 * 远端音频由 **Engine 自己播放**，与画面挂在哪无关。
 *
 * # 为什么这层要存在
 *
 * 原先远端的音视频装在同一条按 uid 的 `MediaStream` 里，挂到 `attachView(uid, el)`
 * 的那个 `<video>` 上才出声。于是**没有格子的人就是彻底静音**：语音版式、页内小窗、
 * 会议翻页之后不在本页的二十几个人，全都听不见。`call-uikit-react` 为此长了一个
 * `RemoteAudioSink` 组件——那是把 Engine 该做的事推给了 Kit，自画 UI 的宿主还得再抄一遍。
 *
 * iOS / Android 从来没有这个问题：它们的远端音频由 WebRTC 原生音频设备直接播放。
 * 这里把 Web 对齐过去（MEETING_ROOM_DESIGN §8 #10 / §9 ②）：
 * **`attachView` 从此只管画面，声音一律由引擎播。**
 *
 * # 为什么一条轨道一个 `<audio>`，而不是一个元素收全部
 *
 * `HTMLMediaElement` 绑一条带多路音频轨的 `MediaStream` 时，浏览器只播其中一路——
 * 「汇进一个元素」实际做不到。真要一个出口就得走 `AudioContext`
 * （每条轨 `createMediaStreamSource` 再 connect 到 destination），
 * 那等于把自动播放解锁、采样率、重采样一整套问题揽进来，换不到任何东西。
 * 元素是引擎自己建的、宿主看不见，几个都一样。
 *
 * # 为什么不按 uid 建
 *
 * 认领不到 uid 的轨道**也要出声**（以后服务端换成音频槽位时，轨道根本没有 uid，
 * 见 §9 路 B）。按 track_id 建，这件事天然成立。
 */

/** AudioSink 是一个能播一条音频轨的出口。取 `HTMLAudioElement` 的最小交集，便于测试替身。 */
export interface AudioSink {
  srcObject: MediaProvider | null;
  autoplay: boolean;
  muted: boolean;
  play(): Promise<void>;
  remove(): void;
}

/** SinkFactory 建一个出口。默认实现建一个隐藏的 `<audio>`，测试里换成替身。 */
export type SinkFactory = (track: MediaStreamTrack) => AudioSink | null;

/** RemoteAudioPlayer 持有全部远端音频的播放出口。 */
export class RemoteAudioPlayer {
  private readonly sinks = new Map<string, AudioSink>();
  private readonly createSink: SinkFactory;

  constructor(createSink: SinkFactory = domAudioSink) {
    this.createSink = createSink;
  }

  /**
   * add 收下一条远端音频轨并立刻播。
   *
   * 重复 add 同一个 track_id 是幂等的——`ontrack` 与认领两条路都可能走到这里。
   */
  add(trackId: string, track: MediaStreamTrack): void {
    if (this.sinks.has(trackId)) return;
    const sink = this.createSink(track);
    if (sink === null) return;
    this.sinks.set(trackId, sink);
    this.start(sink);
  }

  /** remove 摘掉一条（对方停发、退订、离房）。 */
  remove(trackId: string): void {
    const sink = this.sinks.get(trackId);
    if (sink === undefined) return;
    this.sinks.delete(trackId);
    sink.srcObject = null;
    sink.remove();
  }

  /**
   * unlock 再试一次播放，**在一次用户手势的调用栈里调**。
   *
   * 浏览器的自动播放限制会让进房前建出来的出口停在暂停态。进房几乎总是由一次点击
   * 触发（「加入会议」「接听」），所以引擎在 `joinRoom` 那一刻顺手再 `play()` 一遍。
   * 已经在播的调它是空操作。
   */
  unlock(): void {
    for (const [, sink] of this.sinks) this.start(sink);
  }

  /** clear 关掉全部出口（离房、logout）。 */
  clear(): void {
    for (const trackId of [...this.sinks.keys()]) this.remove(trackId);
  }

  /** count 是此刻挂着几个出口，供测试断言。 */
  get count(): number {
    return this.sinks.size;
  }

  private start(sink: AudioSink): void {
    /*
      **播放失败只记一条，不往上抛。**

      自动播放被挡（还没有用户手势）是最常见的一种，而那时正确的做法是等 `unlock()`，
      不是把一个 Promise 拒绝丢给宿主的 `error` 事件——宿主对它无事可做，
      只会在控制台刷一片没人看的红。
    */
    sink.play().catch((err: unknown) => {
      logger.debug('远端音频暂时播不了（多半是自动播放限制，等进房那次点击解锁）', {
        err: String(err),
      });
    });
  }
}

/** domAudioSink 是默认实现：一个隐藏的 `<audio>`。没有 DOM（node 环境）时返回 null。 */
function domAudioSink(track: MediaStreamTrack): AudioSink | null {
  if (typeof document === 'undefined' || typeof MediaStream === 'undefined') return null;
  const el = document.createElement('audio');
  el.autoplay = true;
  /*
    **挂进 document 而不是留一个游离元素**：游离的 `<audio>` 在 iOS Safari 上不出声。
    不设 `display:none`——那在部分浏览器上会让媒体元素停播；`<audio>` 不带 `controls`
    本来就没有可见的盒子，`hidden` 只是让它连布局都不参与。
  */
  el.hidden = true;
  el.srcObject = new MediaStream([track]);
  document.body.appendChild(el);
  return el;
}
