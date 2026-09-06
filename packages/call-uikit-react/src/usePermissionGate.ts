import type { CallEngine } from '@im-rtc/call-engine';
import { logger } from '@im-rtc/call-engine';
import { useCallback, useMemo, useState } from 'react';

import type { DeviceKind, PermissionFailure, PermissionQuery } from './state/permissions.js';
import { blockedCopy, classifyProbeError, explanationCopy, needsExplanation } from './state/permissions.js';
import type { ViewAction } from './state/viewTypes.js';

/**
 * usePermissionGate 是权限申请的三段式（交互稿 §02）：前置说明卡 → 系统框 → 结果分支。
 *
 * `ensure(devices)` 在拨出 / 接听**之前**调，按顺序探每个设备：
 * - 麦克风拿不到 → 出「无法通话」卡，返回 `mic-blocked`——**整通话取消**，不发 invite / accept；
 * - 摄像头拿不到 → 出「已用语音继续」卡，返回 `camera-blocked`——**通话继续**，只是没画面；
 * - 用户在说明卡上点「取消」→ `cancelled`，不留副作用。
 *
 * 卡片是 React 状态（`prompt`），由 `CallOverlay` 画；这里用 promise 把「等用户点」串进流程。
 */
export type EnsureResult = 'ok' | 'camera-blocked' | 'mic-blocked' | 'cancelled';

/** PermissionPromptView 是要画的那张卡。 */
export interface PermissionPromptView {
  readonly kind: 'explain' | 'blocked';
  readonly device: DeviceKind;
  readonly title: string;
  readonly body: string;
  readonly primary: { readonly label: string; readonly onClick: () => void };
  readonly secondary?: { readonly label: string; readonly onClick: () => void };
}

export interface PermissionGate {
  readonly prompt: PermissionPromptView | null;
  readonly ensure: (devices: readonly DeviceKind[]) => Promise<EnsureResult>;
}

export function usePermissionGate(
  engine: CallEngine,
  dispatch: (action: ViewAction) => void,
  query: PermissionQuery,
): PermissionGate {
  const [prompt, setPrompt] = useState<PermissionPromptView | null>(null);

  /** ask 出一张卡并等用户点：主动作 → true，次动作 → false。 */
  const ask = useCallback(
    (view: Omit<PermissionPromptView, 'primary' | 'secondary'>, primary: string, secondary?: string) =>
      new Promise<boolean>((resolve) => {
        const done = (ok: boolean): void => {
          setPrompt(null);
          resolve(ok);
        };
        setPrompt({
          ...view,
          primary: { label: primary, onClick: () => done(true) },
          ...(secondary === undefined ? {} : { secondary: { label: secondary, onClick: () => done(false) } }),
        });
      }),
    [],
  );

  const probe = useCallback(async (kind: DeviceKind): Promise<void> => {
    if (kind === 'microphone') {
      await engine.probeMicrophone();
      return;
    }
    // 摄像头用预览探：它本来就该在拨出时起来给人看见自己（草图 §03-E）。
    const cid = await engine.startLocalPreview();
    dispatch({ type: 'localCamera', cid });
  }, [engine, dispatch]);

  const ensure = useCallback(async (devices: readonly DeviceKind[]): Promise<EnsureResult> => {
    let result: EnsureResult = 'ok';
    for (const kind of devices) {
      /*
        权限状态查询**只用来决定要不要出说明卡**，不用来判失败。
        判失败一律靠真的去探：宿主可能注入了不走 getUserMedia 的媒体源（Demo 的合成源就是），
        浏览器说「已拒绝」而媒体层其实拿得到——信了查询就会把能打的电话拦下来（实测撞到）。
        真被拒的话探测会立刻抛 2001，结果一样，只是多了一次不弹框的调用。
      */
      const status = await query(kind);
      // 首次才出说明卡：系统框只有一次机会，说明卡是为它做铺垫。已授权 / 已拒绝 / 查不到都直接探。
      if (needsExplanation(status)) {
        const copy = explanationCopy(kind);
        const go = await ask({ kind: 'explain', device: kind, ...copy }, '好', '取消');
        if (!go) return 'cancelled';
      }
      let failure: PermissionFailure | null = null;
      try {
        await probe(kind);
      } catch (err) {
        failure = classifyProbeError(err);
        if (failure === null) throw err; // 不是权限问题，别吞
        logger.warn('设备探测失败', { device: kind, failure });
      }
      if (failure === null) continue;
      await ask({ kind: 'blocked', device: kind, ...blockedCopy(kind, failure) }, '知道了');
      if (kind === 'microphone') return 'mic-blocked';
      dispatch({ type: 'cameraBlocked' });
      result = 'camera-blocked';
    }
    return result;
  }, [query, ask, probe, dispatch]);

  return useMemo(() => ({ prompt, ensure }), [prompt, ensure]);
}
