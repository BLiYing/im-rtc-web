import { logger } from '../logger.js';
import type { ViewElement } from './viewRegistry.js';

/**
 * FirstFrameGate 等「某人开摄像头之后，**新画面真的上屏**」这一刻。
 *
 * # 为什么要等
 *
 * 对端关摄像头走的是 `room.track_muted`：轨道不摘，`<video>` 也整通复用，
 * 于是元素上**定格着关之前的最后一帧**。按 `userVideoAvailable(true)` 立刻揭示格子，
 * 露出来的先是那张旧画面、几百毫秒后才换成新画面——看上去就是「刷新了一下」。
 * `MediaBridge.waitForVideo` 那条首帧判据帮不上忙：它按轨道只抛一次，
 * 同一条轨道 mute 再 unmute 不会再抛（2026-09-11 web bob 看 iOS carol 的日志：
 * 开关摄像头十来次，`firstVideoFrame` 只有进房那一条）。
 *
 * # 判据
 *
 * `HTMLVideoElement.requestVideoFrameCallback`：**一帧交给合成器时**回调一次。
 * 这是浏览器上与 Android `SurfaceViewRenderer.addFrameListener`（`IMFirstFrameGate`）对应的那个口子。
 * 元素不支持（老 Firefox / 测试替身）就立刻放行——退回原来「开了就揭示」的行为，不会更差。
 *
 * **「交给合成器」不等于「是新画面」**（2026-09-11 20:49 实测）：关摄像头时格子把 `<video>` 藏起来，
 * 路上还没到的最后几帧落地时元素不可见、没上屏；一开摄像头元素可见，浏览器马上把这张积压的旧帧补上屏，
 * 回调在一两个刷新周期内就来了（`wait_ms` 7 / 20 / 29），而 iOS 那边本端首帧要 180ms 才出——
 * 闸门放行的正是旧画面，紧接着新帧一到又闪一下。所以还要看**这一帧是什么时候收到的**：
 * - 有 `receiveTime`（WebRTC 远端帧，与 `performance.now()` 同一时基）：早于开始等的一律不算，接着等下一帧；
 * - 没有：跳过第一张，`mediaTime` 变了才算（多等一帧，换不闪）。
 *
 * **uikit 那边还有 2 秒兜底**：页面在后台时浏览器不出帧，这里可能迟迟不回调。
 */
export class FirstFrameGate {
  /** uid → 这一轮等待。同一个人再开一次会顶掉上一轮，旧回调认出自己过期就不作数。 */
  private readonly waiting = new Map<string, Waiting>();

  /** arm 开始等 uid 的下一帧上屏。`el` 是他此刻挂着的元素；还没挂就等 `attached`。 */
  arm(uid: string, el: ViewElement | undefined, onFrame: () => void): void {
    const entry: Waiting = {
      sinceMs: Date.now(), armedAt: performance.now(), onFrame, watched: new Set(), skipped: 0, firstMediaTime: undefined,
    };
    this.waiting.set(uid, entry);
    if (el !== undefined) this.watch(uid, entry, el);
  }

  /**
   * attached 是 uid 挂上了（新的）元素。
   *
   * **「人先进来、格子后摆」是常态**：事件抛出去的那一刻 React 还没提交，格子里的 `<video>`
   * 还不存在。不在挂载时补等，这一轮就只能靠 uikit 的兜底计时器揭示。
   */
  attached(uid: string, el: ViewElement): void {
    const entry = this.waiting.get(uid);
    if (entry !== undefined) this.watch(uid, entry, el);
  }

  /** clear 忘掉全部等待（一轮房间结束）。 */
  clear(): void {
    this.waiting.clear();
  }

  private watch(uid: string, entry: Waiting, el: ViewElement): void {
    // 同一个元素重挂不重复登记：每条登记都会逐帧续约，重一条就多一条链。
    if (entry.watched.has(el)) return;
    entry.watched.add(el);
    if (!reportsFrames(el)) {
      logger.info('浏览器报不了画面上屏，开摄像头即揭示', { uid });
      this.settle(uid, entry);
      return;
    }
    this.nextFrame(uid, entry, el);
  }

  private nextFrame(uid: string, entry: Waiting, el: FrameReporter): void {
    el.requestVideoFrameCallback((now, frame) => {
      if (this.waiting.get(uid) !== entry) return;
      if (isStale(entry, frame)) {
        entry.skipped += 1;
        this.nextFrame(uid, entry, el);
        return;
      }
      logger.info('远端开摄像头后新画面上屏', {
        uid,
        wait_ms: Date.now() - entry.sinceMs,
        skipped: entry.skipped,
        judged_by: judgedBy(frame),
        received_ago_ms: typeof frame?.receiveTime === 'number' ? Math.round(now - frame.receiveTime) : -1,
      });
      this.settle(uid, entry);
    });
  }

  private settle(uid: string, entry: Waiting): void {
    // 已经落定、被新一轮顶掉、或整轮清掉了：都不作数。
    if (this.waiting.get(uid) !== entry) return;
    this.waiting.delete(uid);
    entry.onFrame();
  }
}

interface Waiting {
  readonly sinceMs: number;
  /** 开始等的时刻，`performance.now()` 时基，与帧的 `receiveTime` 可比。 */
  readonly armedAt: number;
  readonly onFrame: () => void;
  readonly watched: Set<ViewElement>;
  /** 跳过的旧帧数，只进落定那条日志。 */
  skipped: number;
  /** 没有 `receiveTime` 时记下第一张的 `mediaTime`，变了才算新帧。 */
  firstMediaTime: number | undefined;
}

type FrameMetadata = Pick<VideoFrameCallbackMetadata, 'mediaTime' | 'receiveTime'>;

/** FrameReporter 是能报「一帧上屏了」的元素。`ViewElement` 保持最小，这里按能力探测。 */
interface FrameReporter {
  requestVideoFrameCallback(callback: (now: number, frame?: FrameMetadata) => void): number;
}

function reportsFrames(el: ViewElement): el is ViewElement & FrameReporter {
  return typeof (el as Partial<FrameReporter>).requestVideoFrameCallback === 'function';
}

/** isStale 判这一帧是不是关摄像头之前的旧画面。拿不到任何元数据就当新帧，不拖住揭示。 */
function isStale(entry: Waiting, frame: FrameMetadata | undefined): boolean {
  if (frame === undefined) return false;
  if (typeof frame.receiveTime === 'number') return frame.receiveTime < entry.armedAt;
  if (typeof frame.mediaTime !== 'number') return false;
  if (entry.firstMediaTime === undefined) {
    entry.firstMediaTime = frame.mediaTime;
    return true;
  }
  return frame.mediaTime === entry.firstMediaTime;
}

function judgedBy(frame: FrameMetadata | undefined): string {
  if (typeof frame?.receiveTime === 'number') return 'receive_time';
  return typeof frame?.mediaTime === 'number' ? 'media_time' : 'none';
}
