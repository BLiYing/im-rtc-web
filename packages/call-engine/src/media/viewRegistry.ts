/**
 * uid ↔ 视频元素的挂载登记。
 *
 * # 为什么这层要存在
 *
 * CONVENTIONS §1：**uikit 禁止直接碰 `RTCPeerConnection`**，视频一律经
 * `engine.attachView(uid, el)` 挂载。有了这条边界，换媒体实现时 uikit 一行不用改。
 *
 * # 为什么不能「收到轨道就挂上去」
 *
 * 轨道到达与「知道它是谁的」是**两个独立的时序**：`ontrack` 在第一个 RTP 包到达时触发，
 * 而 `room.track_published`（带 uid）是信令帧，两者谁先到都可能。
 * 所以这里按 track_id 收轨道、按 uid 认领，**认领可以迟到**——
 * 迟到时把已经攒着的轨道补挂上去。漏掉这一步的表现是「有声音没画面」，
 * 且只在网络较快时偶发。
 */

/**
 * ViewElement 是能承载 MediaStream 的元素。取 DOM 的最小交集，便于在测试里做替身。
 *
 * `srcObject` 的类型跟 `HTMLMediaElement` 保持一致（`MediaProvider | null`）——
 * 写成更窄的 `MediaStream | null` 的话，真正的 `<video>` 反而**赋不进来**：
 * TS 的可变属性是不变的，窄类型不接受宽类型。
 */
export interface ViewElement {
  srcObject: MediaProvider | null;
}

/** ViewRegistry 管「哪条轨道属于谁」与「谁挂在哪个元素上」。 */
export class ViewRegistry {
  /** uid → 该用户的媒体流（音视频合在一条流里，浏览器才会同步播放）。 */
  private readonly streams = new Map<string, MediaStream>();
  /** uid → 已挂载的元素。 */
  private readonly views = new Map<string, ViewElement>();
  /** track_id → 还没认领归属的轨道。 */
  private readonly orphans = new Map<string, MediaStreamTrack>();
  /** track_id → uid，认领之后的记账，退订时按 track_id 摘轨道要用。 */
  private readonly owners = new Map<string, string>();

  /**
   * addTrack 收下一条下行轨道。
   *
   * uid 为空表示「还不知道是谁的」——先存进 orphans，等 claim 来认领。
   */
  addTrack(trackId: string, track: MediaStreamTrack, uid: string): void {
    if (uid === '') {
      this.orphans.set(trackId, track);
      return;
    }
    this.orphans.delete(trackId);
    this.owners.set(trackId, uid);
    this.streamOf(uid).addTrack(track);
    this.refresh(uid);
  }

  /**
   * claim 认领一条之前不知道归属的轨道。
   *
   * engine 在 `room.track_published` 到达、或状态机补上 track_id → uid 之后调它。
   * 认领不到（轨道还没来）时什么都不做——轨道到达时会走 addTrack 那条路。
   */
  claim(trackId: string, uid: string): void {
    const track = this.orphans.get(trackId);
    if (track === undefined || uid === '') return;
    this.addTrack(trackId, track, uid);
  }

  /** removeTrack 摘掉一条轨道（对方停发或退订）。 */
  removeTrack(trackId: string): void {
    this.orphans.delete(trackId);
    const uid = this.owners.get(trackId);
    if (uid === undefined) return;
    this.owners.delete(trackId);

    const stream = this.streams.get(uid);
    if (stream === undefined) return;
    for (const track of stream.getTracks()) {
      if (track.id === trackId) stream.removeTrack(track);
    }
    if (stream.getTracks().length === 0) this.streams.delete(uid);
    this.refresh(uid);
  }

  /**
   * attach 把某个 uid 的画面挂到元素上；`el` 传 null 表示卸载。
   *
   * **卸载必须做**：组件卸载时不清 `srcObject`，被卸掉的 <video> 会连着
   * MediaStream 一起被引用，画面停了但解码器还占着（CONVENTIONS §5）。
   */
  attach(uid: string, el: ViewElement | null): void {
    if (el === null) {
      const previous = this.views.get(uid);
      if (previous !== undefined) previous.srcObject = null;
      this.views.delete(uid);
      return;
    }
    this.views.set(uid, el);
    this.refresh(uid);
  }

  /** streamFor 取某人的流，宿主想自己挂载时用。 */
  streamFor(uid: string): MediaStream | undefined {
    return this.streams.get(uid);
  }

  /** clear 清空全部登记（通话结束 / logout）。 */
  clear(): void {
    for (const [, el] of this.views) el.srcObject = null;
    this.views.clear();
    this.streams.clear();
    this.orphans.clear();
    this.owners.clear();
  }

  private streamOf(uid: string): MediaStream {
    let stream = this.streams.get(uid);
    if (stream === undefined) {
      stream = new MediaStream();
      this.streams.set(uid, stream);
    }
    return stream;
  }

  private refresh(uid: string): void {
    const el = this.views.get(uid);
    if (el === undefined) return;
    el.srcObject = this.streams.get(uid) ?? null;
  }
}
