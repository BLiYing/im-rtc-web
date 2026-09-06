import type { MediaType } from '@im-rtc/call-engine';
import { ErrorCode, isRtcError } from '@im-rtc/call-engine';

/**
 * 权限申请的决策逻辑（交互稿 §01–§02），**纯函数 + 一个可注入的查询器**。
 *
 * 三段式：前置说明卡 → 系统框 → 结果分支。说明卡**不是每次都出**：
 * - `prompt`（首次）：先出说明卡再探——系统框只有一次机会，说明卡是为它做铺垫；
 * - `granted`：一个框都不出，直接开始；
 * - `denied`：系统框不会再出现，直接进「被拒」分支；
 * - `unknown`：查不到（Safari 不支持 `permissions.query`），**直接探**——
 *   授权过的话 `getUserMedia` 成功得飞快，等于没弹；别为此写一堆嗅探。
 */

/** DeviceKind 是要申请的设备。 */
export type DeviceKind = 'microphone' | 'camera';

/** PermissionStatus 是四种权限状态。 */
export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown';

/** PermissionQuery 查某个设备的权限状态。可注入：测试里不需要真浏览器。 */
export type PermissionQuery = (kind: DeviceKind) => Promise<PermissionStatus>;

/**
 * browserPermissionQuery 是浏览器实现。
 *
 * `navigator.permissions.query({name:'camera'})` 在 Safari 上抛错，在 Firefox 上部分版本
 * 也抛——一律吞成 `unknown`，由调用方直接去探。
 */
export const browserPermissionQuery: PermissionQuery = async (kind) => {
  if (typeof navigator === 'undefined' || navigator.permissions === undefined) return 'unknown';
  try {
    // `name` 的类型表里还没有 camera/microphone，所以要断言；运行时浏览器认得它们。
    const status = await navigator.permissions.query({ name: kind as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
};

/** devicesFor 决定一次动作要申请哪些设备（交互稿 §01 的表）。 */
export function devicesFor(mediaType: MediaType, withCamera: boolean): readonly DeviceKind[] {
  // 麦克风先问：它被拒了整通话都不成立，没必要再问摄像头。
  return mediaType === 'video' && withCamera ? ['microphone', 'camera'] : ['microphone'];
}

/** needsExplanation 决定要不要先出我们自己的说明卡。 */
export function needsExplanation(status: PermissionStatus): boolean {
  return status === 'prompt';
}

/** PermissionFailure 是探测失败的两种结局。 */
export type PermissionFailure = 'denied' | 'no-device';

/** classifyProbeError 把 engine 抛出的错误归成两类；别的错误不是权限问题，原样抛回去。 */
export function classifyProbeError(err: unknown): PermissionFailure | null {
  if (!isRtcError(err)) return null;
  if (err.code === ErrorCode.devicePermissionDenied) return 'denied';
  if (err.code === ErrorCode.deviceNotFound) return 'no-device';
  return null;
}

/** explanationCopy 是说明卡的文案（规范 §08）：说清**用来做什么**，不说「请授权」。 */
export function explanationCopy(kind: DeviceKind): { title: string; body: string } {
  return kind === 'microphone'
    ? { title: '需要用到麦克风', body: '通话时对方要听见你的声音。接下来浏览器会问你要不要允许。' }
    : { title: '需要用到摄像头', body: '视频通话时对方要看见你。接下来浏览器会问你要不要允许。' };
}

/** blockedCopy 是被拒 / 无设备时的文案。麦克风走不下去；摄像头降级为语音继续。 */
export function blockedCopy(kind: DeviceKind, failure: PermissionFailure): { title: string; body: string } {
  if (kind === 'camera') {
    return failure === 'denied'
      ? { title: '没有摄像头权限，已用语音继续通话', body: '要开视频，请点地址栏左侧的图标允许摄像头。' }
      : { title: '找不到可用的摄像头，已用语音继续通话', body: '摄像头可能被其他程序占用。' };
  }
  return failure === 'denied'
    ? { title: '没有麦克风权限，无法通话', body: '请点地址栏左侧的图标允许麦克风后重试。' }
    : { title: '找不到可用的麦克风', body: '请检查麦克风是否接好、有没有被其他程序占用。' };
}
