import type { CallEngine } from '@im-rtc/call-engine';
import { logger } from '@im-rtc/call-engine';
import { useEffect, useRef } from 'react';

import type { PermissionQuery } from './state/permissions.js';
import { shouldPreviewWhileRinging } from './state/permissions.js';
import type { CallViewState, ViewAction } from './state/viewTypes.js';

/** RingingPreviewDeps 是 useRingingPreview 的依赖。 */
export interface RingingPreviewDeps {
  readonly engine: CallEngine;
  readonly state: CallViewState;
  readonly dispatch: (action: ViewAction) => void;
  readonly query: PermissionQuery;
  /** 此刻显示的是来电页（不是横幅）。见 `showsIncomingPage`。 */
  readonly pageShown: boolean;
}

/**
 * useRingingPreview 在来电页上起本端预览：接起来之前就看得见自己（草图 §03-F）。
 *
 * 三条纪律，与 iOS `startRingingPreviewIfAllowed` 一致：
 * - **只在来电页起，横幅上不起**——横幅上没有预览位，起了就是摄像头灯亮着却看不见自己；
 * - **只在早就授过权时起**（`shouldPreviewWhileRinging`），响铃中不弹任何权限框；
 * - **失败只记日志，不置 cameraBlocked**。Safari 要求 `getUserMedia` 出自用户手势，而这里是
 *   effect 驱动的——被拒不代表用户没给权限。按钮打成「无权限」的话，接听那一下（真手势）就再也不去申请了。
 *
 * 在 effect 里开摄像头也是这条路：来电页上把摄像头从关点到开，deps 变了就会再走一遍。
 */
export function useRingingPreview({ engine, state, dispatch, query, pageShown }: RingingPreviewDeps): void {
  /** 这一通铃里是不是已经在起（或起好了）。失败 / 没授权时放开，好让再点一次摄像头时重试。 */
  const starting = useRef(false);
  /** 每离开一次 incoming 加一：异步链回来时拿它认出「铃已经不响了」。 */
  const ringToken = useRef(0);
  /** 最新状态。异步链回来时判断摄像头**此刻**还开不开，不用闭包里那份旧的。 */
  const latest = useRef(state);
  latest.current = state;
  const queryRef = useRef(query);
  queryRef.current = query;

  const { phase, mediaType, localCameraCid } = state;
  const { cameraOn, cameraBlocked } = state.self;

  useEffect(() => {
    if (phase !== 'incoming') {
      ringToken.current += 1;
      starting.current = false;
      return;
    }
    if (!pageShown || localCameraCid !== '' || starting.current) return;
    // 不必查权限就能判否的先挡掉：语音来电、摄像头关着、已禁用。
    if (mediaType !== 'video' || !cameraOn || cameraBlocked) return;
    starting.current = true;
    const token = ringToken.current;
    const stillRinging = (): boolean => ringToken.current === token;

    void (async (): Promise<void> => {
      try {
        const status = await queryRef.current('camera');
        if (!stillRinging()) return;
        const now = latest.current;
        if (!shouldPreviewWhileRinging(now.mediaType, now.self.cameraOn, now.self.cameraBlocked, status)) {
          starting.current = false;
          return;
        }
        const cid = await engine.startLocalPreview();
        // 铃已经不响了（拒接 / 对方取消）：别把这个 cid 写进后面的状态。
        if (stillRinging()) dispatch({ type: 'localCamera', cid });
      } catch (err) {
        logger.warn('来电页预览起不来，接听时再申请', { err: String(err) });
        if (stillRinging()) starting.current = false;
      }
    })();
  }, [phase, pageShown, localCameraCid, mediaType, cameraOn, cameraBlocked, engine, dispatch]);
}
