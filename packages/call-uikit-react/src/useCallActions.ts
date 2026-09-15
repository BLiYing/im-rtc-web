import type { CallEngine, CallOptions, MediaType } from '@im-rtc/call-engine';
import { ErrorCode, isRtcError, logger } from '@im-rtc/call-engine';
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { EndAction } from './redButtonWatchdog.js';
import { RedButtonWatchdog, endActionFor, endWatchdogReason, timerSchedule } from './redButtonWatchdog.js';
import { defaultCameraOn } from './state/callView.js';
import { classifyProbeError, devicesFor, devicesForAnswering } from './state/permissions.js';
import type { CallViewState, ViewAction } from './state/viewTypes.js';
import type { PermissionGate } from './usePermissionGate.js';

/** CallActions 是界面能做的全部动作。 */
export interface CallActions {
  /**
   * placeCall 拨出。**先探权限再发 invite**（交互稿 §01）。
   *
   * `options` 与 `CallEngine.call()` 同形：传布尔值等同旧的 `isGroup` 参数；传
   * {@link CallOptions} 可以带上群号 / user_data（HOST_INTEGRATION_DESIGN §3.2）。
   */
  placeCall: (calleeIds: string[], mediaType: MediaType, options?: boolean | CallOptions) => Promise<void>;
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
   *
   * 按下之后还要**盯着这一屏到底走没走**（见 `RedButtonWatchdog`）：认得出该发哪一帧，
   * 不等于那一帧真的发得出去。
   */
  end: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  /** inviteMore 往群通话里加人；先摆占位格再发帧。 */
  inviteMore: (uids: readonly string[]) => Promise<void>;
  setMinimized: (minimized: boolean) => void;
  /** setSwapped 互换 1v1 的两块画面。纯本端行为。 */
  setSwapped: (swapped: boolean) => void;
  /** expandIncoming 把来电横幅展开成来电页（点横幅本体）。 */
  expandIncoming: () => void;
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
  /** 红键看门狗等多久（见 `RedButtonWatchdog`）。 */
  readonly endWatchdogMs: number;
}

/**
 * useCallActions 把界面动作接到 engine 上。逻辑与渲染分离（CONVENTIONS §2）。
 */
export function useCallActions({ engine, state, dispatch, cids, gate, endWatchdogMs }: CallActionsDeps): {
  readonly actions: CallActions;
  readonly publishFor: (mediaType: MediaType, withCamera: boolean) => Promise<void>;
  readonly joinCall: (callId: string) => Promise<void>;
} {
  /** 最新状态。异步链回来时判断摄像头**此刻**还开不开，不用闭包里那份旧的。 */
  const latest = useRef(state);
  latest.current = state;

  /**
   * publishFor 推本端媒体。
   *
   * **摄像头失败不能连累麦克风**：没有摄像头（或权限被拒）时通话照样该能打，
   * 只是没有画面。失败要留痕：按钮变「无权限」，日志也要有。
   */
  const publishFor = useCallback(
    async (mediaType: MediaType, withCamera: boolean): Promise<void> => {
      /*
        **麦克风也要接住。** 这里原先是裸 await，而调用点是 effect 里的
        `void publishFor(...)`——推流失败时那条 promise 静静变成 unhandled rejection：
        界面照常显示已接通、计时器在走、静音按钮显示未静音，**可对方什么也听不见**，
        而且抛出去之后下面的摄像头分支整个不执行，连画面也一起没了。

        权限门里的探测是「探完就 stop() 放掉设备」，所以从探到真正 acquire 之间
        设备完全可能被别的程序抢走（或者用户拔了 USB 麦），这不是罕见路径。
        接住之后：出一条提示、继续去推摄像头——与 iOS 的 `try?` 同一个取舍。
      */
      try {
        cids.current.mic = await engine.publishMicrophone();
      } catch (err) {
        logger.warn('麦克风推流失败，对方听不到你', { err: String(err) });
        dispatch({ type: 'hint', text: '麦克风打不开，对方听不到你' });
      }
      // **摄像头由调用方明说要不要，不在这里读 state**：这个函数在 effect 里被调用，
      // 闭包捕获的 state 未必是最新的一次提交。
      if (mediaType !== 'video') return;
      if (!withCamera) {
        // 关着摄像头接通：进房前起过的预览（如果还有）这时一定要停掉，否则指示灯一直亮到挂断。
        await engine.stopLocalPreview();
        return;
      }
      try {
        cids.current.cam = await engine.publishCamera();
        dispatch({ type: 'localCamera', cid: cids.current.cam });
        // 发布是异步的，这期间用户可能已经点了关摄像头（那一下看到 cam 还是空的，什么也没做）——补一遍。
        if (!latest.current.self.cameraOn) await engine.setMuted(cids.current.cam, true);
      } catch (err) {
        logger.warn('摄像头推流失败，本通只有声音', { err: String(err) });
        if (classifyProbeError(err) !== null) dispatch({ type: 'cameraBlocked' });
      }
    },
    [engine, dispatch, cids],
  );

  /**
   * startPreview 起本端预览，让人在接通前就看得见自己（草图 §03-E）。
   *
   * **只在摄像头开着时调**：权限门只问权限、不开摄像头，开不开由这里按 `self.cameraOn` 决定。
   * 权限门刚放行过，这里再失败多半是设备被别的程序抢了——按钮变禁用，通话照打。
   */
  const startPreview = useCallback(async (): Promise<void> => {
    try {
      const cid = await engine.startLocalPreview();
      // 起的这段时间里摄像头被关掉了：不写 cid。停采集由关的那一下负责（它会等这次起完再停）。
      if (latest.current.self.cameraOn) dispatch({ type: 'localCamera', cid });
    } catch (err) {
      logger.warn('本端预览起不来', { err: String(err) });
      if (classifyProbeError(err) !== null) dispatch({ type: 'cameraBlocked' });
    }
  }, [engine, dispatch]);

  /*
    红键看门狗（见 `RedButtonWatchdog`）。这一屏走了（idle / ended）就撤，卸载时也撤——
    定时器成对清理（CONVENTIONS §7）。
  */
  const watchdog = useMemo(() => new RedButtonWatchdog(timerSchedule, endWatchdogMs), [endWatchdogMs]);
  useEffect(() => () => watchdog.disarm(), [watchdog]);
  useEffect(() => {
    if (state.phase === 'idle' || state.phase === 'ended') watchdog.disarm();
  }, [state.phase, watchdog]);

  /**
   * armEnd：按下红键记一条，并开始盯着这一屏走没走。
   *
   * 到点还在通话里就**两件事一起做**：界面本地收场，再让 engine 也离场（`forceEnd`）。
   * 只收界面的话，结束帧没发出去时 engine 还留在通话与房间里——别人一直看得见他，
   * 摄像头麦克风也还开着（2026-09-13 14:54 iOS frank，直到 14:58 整通结束才被带走）。
   */
  const armEnd = useCallback(
    (action: EndAction): void => {
      // **按下红键要留一条**：那次到底按没按、按的时候在哪个阶段，事后只能靠猜。
      logger.info('[uikit] 按下红键', { action, phase: latest.current.phase });
      const reason = endWatchdogReason(action);
      watchdog.arm(() => {
        const phase = latest.current.phase;
        if (phase === 'idle' || phase === 'ended') return;
        logger.warn('[uikit] 红按钮本地收场：没等到结束事件', { phase, reason, timeout_ms: watchdog.timeoutMs });
        dispatch({ type: 'callEnd', reason, durationSec: 0 });
        engine.forceEnd();
      });
    },
    [engine, dispatch, watchdog],
  );

  const actions = useMemo<CallActions>(
    () => ({
      placeCall: async (calleeIds, mediaType, options): Promise<void> => {
        const opts: CallOptions = typeof options === 'boolean' ? { isGroup: options } : (options ?? {});
        const isGroup = opts.isGroup ?? false;
        dispatch({
          type: 'callPlaced', calleeIds, mediaType, isGroup,
          chatGroupId: opts.chatGroupId ?? '', userData: opts.userData ?? '',
        });
        // **拿不到麦克风就不该去响别人的铃**：先探权限，再发 invite。
        const gateResult = await gate.ensure(devicesFor(mediaType, true));
        if (gateResult === 'cancelled' || gateResult === 'mic-blocked') {
          dispatch({ type: 'dismiss' });
          return;
        }
        // 群通话默认关着摄像头进来：权限照问（交互稿 §01），摄像头不开。
        if (gateResult === 'ok' && defaultCameraOn(mediaType, isGroup)) await startPreview();
        await engine.call(calleeIds, mediaType, options);
      },
      joinMeeting: async (roomId, roomToken): Promise<void> => {
        const gateResult = await gate.ensure(devicesFor('video', true));
        if (gateResult === 'cancelled' || gateResult === 'mic-blocked') return;
        dispatch({ type: 'meetingJoined', roomId, nowMs: Date.now() });
        /*
          **进房这一步抛了就要把界面收回来。** 先摆界面是对的（不然点下去几百毫秒没反应），
          但 `joinRoom` 会**同步**抛 1004：`checkRoomId` 拦下带空格 / 中文的房间号，
          而「拿群名当房间号」正是宿主最常见的写法。不收的话界面永远停在
          「正在进入会议…」——既没有 roomLeft 也没有 callEnd，红按钮走 leaveRoom 又被
          房间机以 2005 本地拒掉，拨号面板的 `busy` 还把所有按钮一起禁死，只能刷新页面。

          只包 `joinRoom` 这一句：**进房成功之后的失败不能收界面**——那时人已经在房里了，
          收掉界面等于把一场还在进行的会议从屏幕上抹掉。推流失败由 publishFor 自己出提示。
        */
        try {
          await engine.joinRoom(roomId, roomToken);
        } catch (err) {
          dispatch({ type: 'dismiss' });
          throw err; // 调用方（宿主的拨号面板）还要把这条错误显示出来
        }
        await publishFor('video', gateResult !== 'camera-blocked'); // 会议恒为视频
        dispatch({ type: 'setCamera', on: gateResult !== 'camera-blocked' });
      },
      accept: async (): Promise<void> => {
        /*
          **问不问摄像头，看的是用户有没有在来电页上亲手关掉它**（拍板 §11-10），
          不是 `cameraOn`：群通话默认关着进来，接听照样要问摄像头（交互稿 §01）。
        */
        const gateResult = await gate.ensure(devicesForAnswering(state.mediaType, state.self.cameraOptedOut));
        if (gateResult === 'cancelled' || gateResult === 'mic-blocked') {
          // 接不了就别让对方一直等：拒掉。
          await engine.reject();
          return;
        }
        if (gateResult === 'ok' && state.mediaType === 'video' && state.self.cameraOn) await startPreview();
        await engine.accept();
      },
      reject: async (): Promise<void> => {
        // 来电页上的红键同样要盯着：拒接帧发不出去时，来电页不能一直挂在那儿。
        armEnd('reject');
        await engine.reject();
      },
      end: async (): Promise<void> => {
        /*
          红按钮在四种场合是四个不同的动作，**分辨这件事是 uikit 的责任**（`endActionFor`）。
          最容易错的是会议：**会议房里没有 call**，发 hangup 会被通话机本地拒成 2005。
        */
        const action = endActionFor(state);
        armEnd(action);
        switch (action) {
          case 'leaveRoom':
            return engine.leaveRoom();
          case 'reject':
            return engine.reject();
          case 'cancel':
            return engine.cancel();
          case 'hangup':
            return engine.hangup();
        }
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
        if (state.roomId === '') {
          /*
            **进房前关摄像头 = 真的停采集**（交互稿 §01 v3.7）：只把按钮熄掉的话，
            指示灯要一直亮到通话结束。cid 先清掉，本端小窗立刻收起，不去挂一条马上要停的轨道。
          */
          if (!on) {
            if (state.mediaType !== 'video') return;
            dispatch({ type: 'localCamera', cid: '' });
            await engine.stopLocalPreview();
            return;
          }
          // 拨出中打开摄像头：权限拨出前问过了，这时起预览好让人看见自己。
          // 来电页上打开由 useRingingPreview 起（只在早就授过权时）。
          if (state.phase === 'outgoing' && state.localCameraCid === '') await startPreview();
          return;
        }
        // 第一次开摄像头要真的发布；之后只是开关，**不走 unpublish**——
        // 反复 publish/unpublish 会触发重协商风暴（协议 §3.2）。关 = 停采集，开 = 重新采集换上去。
        if (cids.current.cam !== '') {
          const cam = cids.current.cam;
          try {
            await engine.setMuted(cam, !on);
          } catch (err) {
            // 重新采集被拒（权限刚被收回 / 设备被别的程序占了）：按钮弹回去，别假装出镜了。
            logger.warn('通话中切换摄像头失败', { err: String(err), on });
            if (!on) return;
            dispatch({ type: 'setCamera', on: false });
            if (classifyProbeError(err) !== null) dispatch({ type: 'cameraBlocked' });
          }
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
          // **本端格子靠 localCameraCid 才挂得上画面**：漏了这一下是「对端看得见我、我自己看不见我」。
          // 原先被遮住是因为权限门顺手起了预览；群通话默认关摄像头进来之后，通话中点开必走这条。
          dispatch({ type: 'localCamera', cid: cids.current.cam });
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
            **邀请没发出去就要把占位格收回来。** 服务端拒掉（1407 本端不在通话里 / 1202 满员）时
            不会有 `userReject` / `userNoResponse` ——那两条是给「真的响了铃的人」的。
            不收的话，那几格会一直挂着「呼叫中…」到通话结束，而且还占着人数，
            让「还能加 N 人」和九宫格的行列都算错一格。
          */
          logger.warn('加人失败，收回占位格', { err: String(err), uids: uids.join(',') });
          for (const uid of uids) dispatch({ type: 'userRemove', uid });
          // 1409：宿主的邀请鉴权回调拒了这一批人（HOST_INTEGRATION_DESIGN §3.4 的加人文案）。
          if (isRtcError(err) && err.code === ErrorCode.inviteDenied) {
            dispatch({ type: 'hint', text: '对方暂时无法被邀请' });
          }
        }
      },
      setMinimized: (minimized): void => dispatch({ type: 'setMinimized', minimized }),
      setSwapped: (swapped): void => dispatch({ type: 'setSwapped', swapped }),
      expandIncoming: (): void => dispatch({ type: 'expandIncoming' }),
      dismiss: (): void => dispatch({ type: 'dismiss' }),
    }),
    [engine, dispatch, cids, gate, publishFor, startPreview, armEnd, state, state.phase, state.mediaType,
     state.isMeeting, state.roomId, state.localCameraCid, state.self.micOn, state.self.cameraOn,
     state.self.cameraBlocked, state.self.cameraOptedOut],
  );

  /**
   * joinCall 是「群成员看到『进行中』主动加入」（协议 §4.1 `call.join`，`useCall().joinCall`）。
   *
   * # 为什么不能靠 `try/catch` 拿失败
   *
   * `CallEngine.joinCall()` 与状态机之间隔着 `FrameLoop.sendFrame`——请求被服务端拒绝时
   * 它在内部把错误转成 `error` 事件再走 `rollback`，**从不把异常抛给调用方**
   * （`inviteMore` 头上那段 `try/catch` 出于同一个误解，实际上也从未真的捕获到过网络层错误）。
   * 所以这里在发起前先挂一个临时的 `error` 监听器，`await` 整条链路跑完再看有没有记到码——
   * `engine.joinCall()` 的 promise 在 `call_failed → onCallEnd` 那一串同步完成之后才落定，
   * 所以退订之后 `failCode` 要么是 `null`（成功），要么已经是那一次失败的码。
   */
  const joinCall = useCallback(async (callId: string): Promise<void> => {
    /*
      **已经在一场里就不接，只提示。** engine 只会本地回一个 2005，而下一步就把界面切成「接通中…」——
      放行的话正在进行的那通电话的界面被盖掉、随后收场成「已结束」，人却还在通话里（2026-09-15 代码审查）。
    */
    const phase = latest.current.phase;
    if (phase !== 'idle' && phase !== 'ended') {
      logger.warn('[uikit] 正在通话中，忽略 joinCall', { call_id: callId, phase });
      dispatch({ type: 'hint', text: '正在通话中，无法加入' });
      return;
    }
    dispatch({ type: 'joinCallRequested', callId });
    // 与接听同一道权限门，但只要麦克风：加入之前不知道这通是不是视频，摄像头等用户在通话里再开。
    const gateResult = await gate.ensure(devicesFor('audio', false));
    if (gateResult === 'cancelled' || gateResult === 'mic-blocked') {
      dispatch({ type: 'dismiss' });
      return;
    }
    let failCode: number | null = null;
    const off = engine.on('error', (e) => {
      failCode = e.code;
    });
    try {
      await engine.joinCall(callId);
    } finally {
      off();
    }
    /*
      **失败与否以通话机的状态为准，错误事件只用来挑文案。** `error` 是全局事件、不带 call_id，
      这段 await 期间冒出来的不一定属于这次加入；真被拒时通话机已经退回 idle，加入成功则停在 accepting 之后。
    */
    if (failCode !== null && engine.state.call.state === 'idle') {
      logger.warn('joinCall 被拒', { call_id: callId, code: failCode });
      dispatch({ type: 'joinCallFailed', code: failCode });
    }
  }, [engine, dispatch, gate]);

  return { actions, publishFor, joinCall };
}
