import { ErrorCode, RtcError } from '../errors.js';
import type { MediaSource } from './mediaAdapter.js';

/**
 * captureStream 向 `MediaSource` 取流，并把浏览器的异常收敛成结构化错误：
 * 权限类（`NotAllowedError` / `SecurityError`）→ `2001`，其余一律当「没设备」→ `2002`。
 *
 * 界面怎么表现由 uikit 决定，**这里不弹 alert**（CONVENTIONS §8），只抛错。
 */
export async function captureStream(source: MediaSource, constraints: MediaStreamConstraints): Promise<MediaStream> {
  try {
    return await source.getStream(constraints);
  } catch (cause) {
    const code = isPermissionError(cause) ? ErrorCode.devicePermissionDenied : ErrorCode.deviceNotFound;
    throw new RtcError(code, { cause });
  }
}

function isPermissionError(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError');
}
