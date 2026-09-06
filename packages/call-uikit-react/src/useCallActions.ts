import type { CallEngine, MediaType } from '@im-rtc/call-engine';
import { logger } from '@im-rtc/call-engine';
import type { MutableRefObject } from 'react';
import { useCallback, useMemo } from 'react';

import { classifyProbeError, devicesFor } from './state/permissions.js';
import type { CallViewState, ViewAction } from './state/viewTypes.js';
import type { PermissionGate } from './usePermissionGate.js';

/** CallActions 是界面能做的全部动作。 */
export interface CallActions {
  /** placeCall 拨出。**先探权限再发 invite**（交互稿 §01）。 */
  placeCall: (calleeIds: string[], mediaType: MediaType, isGroup?: boolean) => Promise<void>;
  /** joinMeeting 直接进会议房（不走振铃）。 */
  joinMeeting: (roomId: string, roomToken: string) => Promise<void>;
  accept: () => Promise<void>;
  reject: () => Promise<void>;
  /**
   * end 结束当前这一场，不管它是通话还是会议。
   *
   * **振铃通话接通前是 cancel、接通后是 hangup**（协议 §4.4），
   * **会议是 leaveRoom**（会议房里根本没有 call）。界面上是同一个红按钮——
   * 让调用方去分辨这三件事，迟早有人分辨错。
   */
  end: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  /** inviteMore 往群通话里加人；先摆占位格再发帧。 */
  inviteMore: (uids: readonly string[]) => Promise<void>;
  setMinimized: (minimized: boolean) => void;
  /** setSwapped 互换 1v1 的两块画面。纯本端行为。 */
  setSwapped: (swapped: boolean) => void;
  dismiss: () => void;
}

/** PublishedCids 是本端已发布轨道的 cid。放 ref 不放 state：它不参与渲染。 */
export interface PublishedCids {
  mic: string;
  cam: string;
}

export interface CallActionsDeps {
  readonly engine: CallEngine;
  readonly state: CallViewState;
  readonly dispatch: (action: ViewAction) => void;
  readonly cids: MutableRefObject<PublishedCids>;
  readonly gate: PermissionGate;
}

/**
 * useCallActions 把界面动作接到 engine 上。逻辑与渲染分离（CONVENTIONS §2）。
 */
export function useCallActions({ engine, state, dispatch, cids, gate }: CallActionsDeps): {
  readonly actions: CallActions;
  readonly publishFor: (mediaType: MediaType, withCamera: boolean) => Promise<void>;
} {
  /**
   * publishFor 推本端媒体。
   *
   * **摄像头失败不能连累麦克风**：没有摄像头（或权限被拒）时通话照样该能打，
   * 只是没有画面。失败要留痕：按钮变「无权限」，日志也要有。
   */
  const publishFor = useCallback(
    async (mediaType: MediaType, withCamera: boolean): Promise<void> => {
      cids.current.mic = await engine.publishMicrophone();
      // **摄像头由调用方明说要不要，不在这里读 state**：这个函数在 effect 里被调用，
      // 闭包捕获的 state 未必是最新的一次提交。
      if (mediaType !== 'video' || !withCamera) return;
      try {
        cids.current.cam = await engine.publishCamera();
        dispatch({ type: 'localCamera', cid: cids.current.cam });
      } catch (err) {
        logger.warn('摄像头推流失败，本通只有声音', { err: String(err) });
        if (classifyProbeError(err) !== null) dispatch({ type: 'cameraBlocked' });
      }
    },
    [engine, dispatch, cids],
  );

  const actions = useMemo<CallActions>(
    () => ({
      placeCall: async (calleeIds, mediaType, isGroup = false): Promise<void> => {
        dispatch({ type: 'callPlaced', calleeIds, mediaType, isGroup });
        // **拿不到麦克风就不该去响别人的铃**：先探权限，再发 invite。
        const gateResult = await gate.ensure(devicesFor(mediaType, true));
        if (gateResult === 'cancelled' || gateResult === 'mic-blocked') {
          dispatch({ type: 'dismiss' });
          return;
        }
        await engine.call(calleeIds, mediaType, isGroup);
      },
      joinMeeting: async (roomId, roomToken): Promise<void> => {
        const gateResult = await gate.ensure(devicesFor('video', true));
        if (gateResult === 'cancelled' || gateResult === 'mic-blocked') return;
        dispatch({ type: 'meetingJoined', roomId, nowMs: Date.now() });
        await engine.joinRoom(roomId, roomToken);
        await publishFor('video', gateResult !== 'camera-blocked'); // 会议恒为视频
        dispatch({ type: 'setCamera', on: gateResult !== 'camera-blocked' });
      },
      accept: async (): Promise<void> => {
        // 来电页上关掉了摄像头就别去开它——「以语音接听」走的就是这条。
        const gateResult = await gate.ensure(devicesFor(state.mediaType, state.self.cameraOn));
        if (gateResult === 'cancelled' || gateResult === 'mic-blocked') {
          // 接不了就别让对方一直等：拒掉。
          await engine.reject();
          return;
        }
        await engine.accept();
      },
      reject: async (): Promise<void> => {
        await engine.reject();
      },
      end: async (): Promise<void> => {
        /*
          红按钮在四种场合是四个不同的动作，**分辨这件事是 uikit 的责任**。
          最容易错的是最后一条：**会议房里没有 call**，发 hangup 会被通话机本地拒成 2005。
        */
        if (state.isMeeting) return engine.leaveRoom();
        if (state.phase === 'incoming') return engine.reject();
        if (state.phase === 'outgoing') return engine.cancel();
        return engine.hangup();
      },
      toggleMic: async (): Promise<void> => {
        const on = !state.self.micOn;
        dispatch({ type: 'setMic', on });
        if (cids.current.mic !== '') await engine.setMuted(cids.current.mic, !on);
      },
      toggleCamera: async (): Promise<void> => {
        // 禁用态点了要出提示，不能静默（规范 §06）。
        if (state.self.cameraBlocked) {
          dispatch({ type: 'hint', text: '没有摄像头权限' });
          return;
        }
        const on = !state.self.cameraOn;
        dispatch({ type: 'setCamera', on });
        // **还没进房时只改界面，不去发布**：视频来电页上也有这个开关，那时房间还不存在。
        if (state.roomId === '') return;
        // 第一次开摄像头要真的发布；之后只是开关，**不走 unpublish**——
        // 反复 publish/unpublish 会触发重协商风暴（协议 §3.2）。
        if (cids.current.cam !== '') {
          await engine.setMuted(cids.current.cam, !on);
          return;
        }
        if (!on) return;
        /*
          **发布失败必须落到界面上。** 这里原先是裸 await：`publishCamera` 抛
          2001（用户在系统设置里刚把摄像头关掉）时，调用方是 `void actions.toggleCamera()`，
          于是那条 promise 静静地变成 unhandled rejection，而界面已经乐观地把按钮点亮了——
          **用户以为自己出镜了，对端什么也没收到**。`publishFor` 里有这一段，这条路上漏了。
        */
        try {
          cids.current.cam = await engine.publishCamera();
        } catch (err) {
          logger.warn('开摄像头失败', { err: String(err) });
          dispatch({ type: 'setCamera', on: false });
          if (classifyProbeError(err) !== null) dispatch({ type: 'cameraBlocked' });
        }
      },
      inviteMore: async (uids): Promise<void> => {
        // 占位格**立刻**出现（交互稿 §05 G3），帧随后才发。
        dispatch({ type: 'invited', uids });
        try {
          await engine.inviteMore([...uids]);
        } catch (err) {
          /*
            **邀请没发出去就要把占位格收回来。** 服务端拒掉（1407 非主叫 / 1202 满员）时
            不会有 `userReject` / `userNoResponse` ——那两条是给「真的响了铃的人」的。
            不收的话，那几格会一直挂着「呼叫中…」到通话结束，而且还占着人数，
            让「还能加 N 人」和九宫格的行列都算错一格。
          */
          logger.warn('加人失败，收回占位格', { err: String(err), uids: uids.join(',') });
          for (const uid of uids) dispatch({ type: 'userRemove', uid });
        }
      },
      setMinimized: (minimized): void => dispatch({ type: 'setMinimized', minimized }),
      setSwapped: (swapped): void => dispatch({ type: 'setSwapped', swapped }),
      dismiss: (): void => dispatch({ type: 'dismiss' }),
    }),
    [engine, dispatch, cids, gate, publishFor, state.phase, state.mediaType, state.isMeeting, state.roomId,
     state.self.micOn, state.self.cameraOn, state.self.cameraBlocked],
  );

  return { actions, publishFor };
}
