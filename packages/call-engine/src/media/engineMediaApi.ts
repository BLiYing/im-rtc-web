import type { EngineBus } from '../engineBus.js';
import type { FrameLoop } from '../frameLoop.js';
import type { Layer } from '../signaling/enums.js';
import type { MediaAdapter } from './mediaAdapter.js';

/**
 * 门面那几个媒体方法的**方法体**。
 *
 * 公开签名与文档留在 `CallEngine` 上——那是宿主读的东西，不该为了行数搬走。
 * 搬过来的是它们的**编排**：拿轨道 → 把 cid / kind / simulcast 喂给状态机。
 * 这件事本来就属于媒体层（`mediaPlane` / `mediaBridge` 做的是同一类事），
 * 放在门面里只是让那个文件一直贴着 400 行的红线。
 */

/** MediaApiDeps 是这些编排要用到的那一把东西。 */
export interface MediaApiDeps {
  media: MediaAdapter;
  loop: FrameLoop;
  bus: EngineBus;
}

/** 探麦克风。失败**也走一遍 error 事件**再抛——宿主的契约见 CallEngine.probeMicrophone。 */
export async function probeMicrophone(d: MediaApiDeps): Promise<void> {
  try {
    await d.media.probeMicrophone();
  } catch (err) {
    // 宿主只监听事件表也该知道「这通电话是因为没权限才没打出去」。
    d.bus.emitError(err);
    throw err;
  }
}

/** 探摄像头。与 probeMicrophone 同一个契约：失败先报 error 事件再抛。 */
export async function probeCamera(d: MediaApiDeps): Promise<void> {
  try {
    await d.media.probeCamera();
  } catch (err) {
    d.bus.emitError(err);
    throw err;
  }
}

/**
 * 发布麦克风。顺序是**先拿轨道再拿 cid**：浏览器不允许自定义 track.id，
 * 而服务端靠 msid 里的 cid 认领 m-line（协议 §3.2）。
 */
export async function publishMicrophone(d: MediaApiDeps): Promise<string> {
  const info = await d.media.acquireMicrophone();
  await d.loop.dispatch({
    kind: 'act',
    op: 'publish',
    args: { cid: info.cid, kind: info.kind, source: info.source, simulcast: false },
  });
  return info.cid;
}

/** 发布摄像头。`simulcast` **同时喂给媒体面与信令**——只喂一边就是「报了三层、实际发一层」。 */
export async function publishCamera(d: MediaApiDeps, simulcast: boolean): Promise<string> {
  const info = await d.media.acquireCamera(simulcast);
  await d.loop.dispatch({
    kind: 'act',
    op: 'publish',
    args: { cid: info.cid, kind: info.kind, source: info.source, simulcast },
  });
  return info.cid;
}

/** 开关本端某条轨道。还没拿到 track_id（publish.ok 没回来）时只动本端，不发帧。 */
export async function setMuted(d: MediaApiDeps, cid: string, muted: boolean): Promise<void> {
  d.media.setMuted(cid, muted);
  const trackId = d.loop.state.room.publishTrackIds[cid];
  if (trackId === undefined) return;
  await d.loop.dispatch({ kind: 'act', op: 'mute', args: { track_id: trackId, muted } });
}

/** 报某人画面的层上界。一个 uid 可能有多条视频轨道，逐条报。 */
export async function setRemoteLayer(d: MediaApiDeps, uid: string, layer: Layer): Promise<void> {
  for (const [trackId, info] of Object.entries(d.loop.state.room.remoteTracks)) {
    if (info.uid !== uid || info.kind !== 'video') continue;
    await d.loop.dispatch({
      kind: 'act',
      op: 'update_layer',
      args: { track_id: trackId, max_layer: layer },
    });
  }
}
