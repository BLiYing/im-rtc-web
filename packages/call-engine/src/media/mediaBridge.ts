import type { MediaAdapter, MediaAdapterEvents } from './mediaAdapter.js';
import type { ViewElement } from './viewRegistry.js';
import { ViewRegistry } from './viewRegistry.js';

/** RemoteTrackOwner 是「这条 track_id 是谁的」的最小查询接口。 */
export interface RemoteTrackOwner {
  readonly uid: string;
}

/**
 * MediaBridge 把媒体适配器与 uid↔元素的挂载登记捆在一起。
 *
 * # 为什么捆在一起
 *
 * 这三样东西的生命周期是同一个：**一轮房间**。通话结束、离房、房间被关掉时，
 * PeerConnection 要重建、挂载登记要清空、「首帧抛过没有」也要忘掉。
 * 散在门面里的话，总有一处会在某条结束路径上被漏掉——而漏掉的表现
 * 是下一通电话带着上一通的轨道去协商，服务端只会记一句
 * 「收到未登记的上行 Track」然后丢掉，界面上则是黑屏。
 */
export class MediaBridge {
  readonly adapter: MediaAdapter;
  private readonly views = new ViewRegistry();
  /** 已经抛过「首帧」的轨道，避免重复抛。 */
  private readonly seenVideo = new Set<string>();
  private events: MediaAdapterEvents | null = null;

  constructor(adapter: MediaAdapter) {
    this.adapter = adapter;
  }

  /** open 建两条 PeerConnection。 */
  open(events: MediaAdapterEvents): void {
    this.events = events;
    this.adapter.open(events);
  }

  /**
   * reset 把这一轮的媒体全部归零，并重建 PeerConnection。
   *
   * PC 是**跟着房间走**的：服务端每次进房都新建一对，客户端这边不重建的话，
   * 上一轮的 transceiver 还挂在上面，下一轮的 offer 会多出几条服务端不认识的 m-line。
   */
  reset(): void {
    this.clear();
    this.adapter.close();
    if (this.events !== null) this.adapter.open(this.events);
  }

  /** close 彻底关掉（logout）。 */
  close(): void {
    this.clear();
    this.adapter.close();
    this.events = null;
  }

  /**
   * addRemoteTrack 收下一条下行轨道。
   *
   * uid 允许为空——`ontrack` 与 `room.track_published` 谁先到都可能，
   * 归属后到时由 claim 补上。
   *
   * `onFirstVideo` 在这条视频轨**真的开始出数据**时回调一次，见 waitForVideo。
   */
  addRemoteTrack(
    trackId: string,
    track: MediaStreamTrack,
    uid: string,
    onFirstVideo: (trackId: string) => void,
  ): void {
    this.views.addTrack(trackId, track, uid);
    if (track.kind !== 'video' || this.seenVideo.has(trackId)) return;
    this.seenVideo.add(trackId);
    this.waitForVideo(trackId, track, onFirstVideo);
  }

  /**
   * waitForVideo 等这条视频轨真的开始出数据。
   *
   * **`ontrack` 触发 ≠ 有画面**：远端轨道刚协商完时 `muted === true`，
   * 要等第一个 RTP 包到达才 `unmute`。在 ontrack 那一刻就抛「首帧到达」，
   * UI 会**提前撤掉 loading 然后露出黑屏**——正是这个事件要避免的那件事。
   *
   * 已经 unmute 的（比如轨道复用）就立刻回调，不必等一个永远不会再来的事件。
   */
  private waitForVideo(
    trackId: string,
    track: MediaStreamTrack,
    onFirstVideo: (trackId: string) => void,
  ): void {
    if (track.muted === false) {
      onFirstVideo(trackId);
      return;
    }
    // 测试里的假轨道可能没有事件接口；没有就退回「协商完即视为到达」，
    // 总比一条都不抛强。
    if (typeof track.addEventListener !== 'function') {
      onFirstVideo(trackId);
      return;
    }
    track.addEventListener('unmute', () => onFirstVideo(trackId), { once: true });
  }

  /** claim 把「轨道先到、归属后到」的那些补挂上去。 */
  claim(remoteTracks: Readonly<Record<string, RemoteTrackOwner>>): void {
    for (const [trackId, info] of Object.entries(remoteTracks)) {
      this.views.claim(trackId, info.uid);
    }
  }

  /** attachView 把某个 uid 的远端画面挂到元素上；传 null 卸载。 */
  attachView(uid: string, el: ViewElement | null): void {
    this.views.attach(uid, el);
  }

  /** attachLocalView 把本端某条轨道挂到元素上做预览；传 null 卸载。 */
  attachLocalView(cid: string, el: ViewElement | null): void {
    const key = localViewKey(cid);
    if (el === null) {
      this.views.attach(key, null);
      return;
    }
    const track = this.adapter.localTrack(cid);
    if (track !== undefined) this.views.addTrack(track.id, track, key);
    this.views.attach(key, el);
  }

  private clear(): void {
    this.views.clear();
    this.seenVideo.clear();
  }
}

/**
 * localViewKey 给本端预览一个不会与 uid 撞车的登记键。
 *
 * 本端与远端共用一张登记表（挂载/卸载逻辑完全一样），所以只需要一个前缀区分开。
 * 前缀里带冒号：uid 是宿主给的业务 id，冒号开头的 uid 本来就不该出现在业务里。
 */
function localViewKey(cid: string): string {
  return `:local:${cid}`;
}
