import type { EngineBus } from '../engineBus.js';
import { logger } from '../logger.js';
import { parseCandidate } from '../signaling/candidate.js';
import type { Connection } from '../signaling/connection.js';
import type { PcRole } from '../signaling/enums.js';
import type { FrameSender } from '../signaling/frameSender.js';
import type { MachineInput } from '../state/types.js';
import type { MediaAdapterEvents } from './mediaAdapter.js';
import type { MediaBridge } from './mediaBridge.js';

/**
 * 门面与媒体面之间的**接线**：候选进出、远端轨道落地、PC 状态转成内部事件。
 *
 * 从 `engine.ts` 拆出来的理由与 `roomMachine` / `roomRecv` 那一刀相同（CONVENTIONS §2）：
 * 门面负责「路由输入、填 SDP、派发事件」，这一组只负责「把媒体适配器接上总线」，
 * 本来就是两组关注点。
 *
 * **写成自由函数 + 显式依赖，而不是让它认识 `CallEngine`**：
 * 下面这个接口就是这条接线用到的全部东西，多一样都要先写进来——
 * 反向依赖门面的话，「门面自己不做决策」这条约束用肉眼就再也看不出来了。
 */
export interface MediaPlaneDeps {
  readonly bridge: MediaBridge;
  readonly bus: EngineBus;
  readonly sender: FrameSender;
  /** 当前连接；没登录时为 null。取成函数是因为它会随重连换对象。 */
  connection: () => Connection | null;
  /** 某条远端轨道属于谁；不知道时返回空串。 */
  uidOf: (trackId: string) => string;
  dispatch: (input: MachineInput) => Promise<void>;
}

/** mediaEvents 组装交给 MediaAdapter 的那组回调。 */
export function mediaEvents(deps: MediaPlaneDeps): MediaAdapterEvents {
  return {
    onLocalCandidate: (pc, candidate): void => sendCandidate(deps, pc, candidate),
    onRemoteTrack: (trackId, track): void => onRemoteTrack(deps, trackId, track),
    onConnectionStateChange: (pc, state): void => onPcState(deps, pc, state),
  };
}

/**
 * addRemoteCandidate 把服务端来的候选交给媒体层。
 *
 * **这条路径一开始整条漏了**：候选只往上发、不往下收，于是下行连接能不能建立
 * 全看运气——服务端的 SDP 里**碰巧**已经带上了主机候选就通，
 * 没带上（进房即订阅时协商得早，服务端还没收集完）就永远停在 `new`，
 * 界面上是「格子在、画面黑」，而且不报任何错。
 *
 * `candidate` 为空串表示收集结束，协议要求容忍（§3.3）。
 */
export async function addRemoteCandidate(
  deps: MediaPlaneDeps,
  addTo: (pc: PcRole, init: RTCIceCandidateInit) => Promise<void>,
  data: Readonly<Record<string, unknown>>,
): Promise<void> {
  const parsed = parseCandidate(data);
  if (parsed === null) return; // 空候选 = 收集结束，忽略（§3.3）
  try {
    await addTo(parsed.pc, parsed.init);
  } catch (err) {
    // 乱序候选是常态（协议 §3.3 要求容忍）：转成 error 事件，不中断事件流。
    deps.bus.emitError(err);
  }
}

function sendCandidate(
  deps: MediaPlaneDeps,
  pc: PcRole,
  candidate: RTCIceCandidateInit,
): void {
  const connection = deps.connection();
  if (connection === null) return;
  void deps.sender
    .sendCandidate(connection, pc, candidate)
    .catch((err: unknown) => deps.bus.emitError(err));
}

function onRemoteTrack(deps: MediaPlaneDeps, trackId: string, track: MediaStreamTrack): void {
  // uid 可能还不知道（ontrack 与 track_published 谁先到都可能）——
  // 那就先收着，bridge.claim 会在状态机补上归属之后认领。
  const uid = deps.uidOf(trackId);
  // firstVideoFrame 没有对应的信令帧——它是本地事件，UI 用来撤 loading。
  // **等轨道真的出数据才抛**（见 MediaBridge.waitForVideo）：ontrack 那一刻
  // 还没有任何一帧，提前抛等于让 UI 撤了 loading 去露黑屏。
  deps.bridge.addRemoteTrack(trackId, track, uid, (id) => {
    // uid 这时可能已经被 track_published 补上了，重新取一次比缓存的准。
    const owner = deps.uidOf(id) || uid;
    deps.bus.emit('firstVideoFrame', { uid: owner, trackId: id });
  });
  deps.bus.emit('remoteTrack', { trackId, track });
}

function onPcState(deps: MediaPlaneDeps, pc: PcRole, state: RTCPeerConnectionState): void {
  logger.debug('PC 状态', { pc, state });
  if (pc === 'sub' && state === 'connected') {
    void deps.dispatch({ kind: 'internal', name: 'media_ready' });
  }
}
