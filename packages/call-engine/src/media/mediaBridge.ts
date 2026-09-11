import { FirstFrameGate } from './firstFrameGate.js';
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
  /** 开摄像头之后等新画面上屏的那些人（见 awaitFirstVideoFrame）。 */
  private readonly firstFrames = new FirstFrameGate();
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

  /**
   * syncRemoteTracks 把挂载登记与状态机的远端轨道表对账：**认领新的，摘掉没了的**。
   *
   * # 为什么摘除这一半不能少
   *
   * 原先这里只认领不摘除，`ViewRegistry.removeTrack` 整个是死代码。于是对方关掉摄像头
   * （`room.track_unpublished`）或直接离房之后，那条已经不存在的轨道**仍然挂在该 uid 的
   * `MediaStream` 上、仍然绑在 `<video>.srcObject` 上**：自画 UI 的宿主看到的是一帧
   * 冻住的画面而不是清空（uikit 只是拿 `visibility:hidden` 盖住了它）；同一个人反复
   * 开关摄像头还会让他的流里越堆越多条废轨道，直到整轮房间结束才随 `clear()` 释放。
   *
   * # 两条边界
   *
   * - **orphans 不参与对账**：`ontrack` 先到、`track_published` 后到是常态，那时轨道
   *   还不在 remoteTracks 里——按对账扫的话会把刚到的轨道当场摘掉，正好打断认领机制。
   *   只扫**已认领**的。
   * - **本端预览不归房间管**：它用 `:local:` 前缀登记，永远不在 remoteTracks 里，
   *   扫到就跳过。不跳的话拨出中的自拍小窗会被第一次 dispatch 摘掉。
   */
  syncRemoteTracks(remoteTracks: Readonly<Record<string, RemoteTrackOwner>>): void {
    for (const [trackId, info] of Object.entries(remoteTracks)) {
      this.views.claim(trackId, info.uid);
    }
    for (const [trackId, owner] of this.views.claimedTracks()) {
      if (owner.startsWith(LOCAL_VIEW_PREFIX)) continue;
      if (Object.hasOwn(remoteTracks, trackId)) continue;
      this.views.removeTrack(trackId);
      // 忘掉「首帧抛过了」：同一条 track_id 再回来时该重新抛一次 firstVideoFrame。
      this.seenVideo.delete(trackId);
    }
  }

  /**
   * awaitFirstVideoFrame 等 uid **开摄像头之后的新画面真的上屏**，到了回调一次（带他此刻的视频轨）。
   *
   * 与 `addRemoteTrack` 的首帧判据是两件事：那条按轨道只抛一次，管的是「轨道开始出数据」；
   * 这条每开一次摄像头等一次，管的是「元素上换成新画面了」。为什么要等见 `FirstFrameGate`。
   */
  awaitFirstVideoFrame(uid: string, onFrame: (trackId: string) => void): void {
    this.firstFrames.arm(uid, this.views.viewOf(uid), () => onFrame(this.videoTrackOf(uid)));
  }

  /** attachView 把某个 uid 的远端画面挂到元素上；传 null 卸载。 */
  attachView(uid: string, el: ViewElement | null): void {
    this.views.attach(uid, el);
    if (el !== null) this.firstFrames.attached(uid, el);
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

  /**
   * refreshLocalViews 让本端预览的挂载跟上适配器里的轨道。
   *
   * 本端轨道会在 cid 不变的情况下**换人**：通话中关了摄像头再打开，是重新采集一条、
   * `replaceTrack` 换上去的；进房前关掉摄像头，轨道干脆就没了。`attachLocalView` 只在挂载时取一次轨道，
   * 界面的 effect 又只看 cid——不在这里换掉的话，元素上挂着的还是那条停掉的轨道，自己看到的是定格 / 黑屏。
   */
  refreshLocalViews(): void {
    for (const [trackId, key] of this.views.claimedTracks()) {
      if (!key.startsWith(LOCAL_VIEW_PREFIX)) continue;
      const current = this.adapter.localTrack(key.slice(LOCAL_VIEW_PREFIX.length));
      if (current?.id === trackId) continue;
      // 先摘后挂：流空了会被删掉，再挂时是一条新 MediaStream，<video> 会重新加载。
      this.views.removeTrack(trackId);
      if (current !== undefined) this.views.addTrack(current.id, current, key);
    }
  }

  private clear(): void {
    this.views.clear();
    this.seenVideo.clear();
    this.firstFrames.clear();
  }

  private videoTrackOf(uid: string): string {
    return this.views.streamFor(uid)?.getTracks().find((track) => track.kind === 'video')?.id ?? '';
  }
}

/**
 * LOCAL_VIEW_PREFIX 是本端预览的登记键前缀。
 *
 * 本端与远端共用一张登记表（挂载/卸载逻辑完全一样），所以只需要一个前缀区分开。
 * 前缀里带冒号：uid 是宿主给的业务 id，冒号开头的 uid 本来就不该出现在业务里。
 * `syncRemoteTracks` 的对账要靠它把本端预览摘出去。
 */
const LOCAL_VIEW_PREFIX = ':local:';

/** localViewKey 给本端预览一个不会与 uid 撞车的登记键。 */
function localViewKey(cid: string): string {
  return `${LOCAL_VIEW_PREFIX}${cid}`;
}
