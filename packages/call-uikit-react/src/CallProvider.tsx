import type { CallEngine, MediaType } from '@im-rtc/call-engine';
import type { ReactNode } from 'react';
import { createContext, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { CallViewState, ViewAction } from './state/callView.js';
import { initialCallView, reduceCallView } from './state/callView.js';

/**
 * CallProvider 把 engine 的公开事件接成界面状态。
 *
 * # 它只用公开事件表
 *
 * 这一整个文件里没有一处「内部 API」。uikit 与「宿主自画 UI」拿到的信息完全一致——
 * 这是产品边界的直接体现（CLAUDE.md §9）：**缺信息就补回调表，不开后门**。
 *
 * # 发布是 uikit 的活
 *
 * engine 在 `call.connected` 之后会自动进房，但**不会自动推流**——
 * 推不推、推麦克风还是也推摄像头，是界面的决定。所以这里在 `callBegin` 之后发布。
 */

/** CallActions 是界面能做的全部动作。 */
export interface CallActions {
  /** placeCall 拨出。 */
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
  setMinimized: (minimized: boolean) => void;
  dismiss: () => void;
}

/** CallContextValue 是 context 里的东西。 */
export interface CallContextValue {
  readonly state: CallViewState;
  readonly engine: CallEngine;
  readonly actions: CallActions;
}

export const CallContext = createContext<CallContextValue | null>(null);

/** CallProviderProps 是 Provider 的参数。 */
export interface CallProviderProps {
  readonly engine: CallEngine;
  readonly children: ReactNode;
  /** 结束画面停留多久再自动收起。默认 1500ms（草图 §09）。0 = 不自动收。 */
  readonly endedHoldMs?: number;
}

export function CallProvider({ engine, children, endedHoldMs = 1500 }: CallProviderProps): ReactNode {
  const [state, dispatch] = useReducer(reduceCallView, initialCallView);
  /** 本端已发布轨道的 cid。放 ref 不放 state：它不参与渲染，进 state 会白白多一轮。 */
  const cids = useRef({ mic: '', cam: '' });

  useEffect(() => subscribe(engine, dispatch), [engine]);

  // 结束画面停留一会儿再收起。**计时器必须清理**，否则快速连打两通会互相收掉。
  useEffect(() => {
    if (state.phase !== 'ended' || endedHoldMs <= 0) return;
    const timer = setTimeout(() => dispatch({ type: 'dismiss' }), endedHoldMs);
    return () => clearTimeout(timer);
  }, [state.phase, endedHoldMs]);

  // 通话结束时清掉发布记录，下一通才不会拿着上一通的 cid 去 mute。
  useEffect(() => {
    if (state.phase === 'idle') cids.current = { mic: '', cam: '' };
  }, [state.phase]);

  const publishFor = useCallback(
    async (mediaType: MediaType): Promise<void> => {
      cids.current.mic = await engine.publishMicrophone();
      if (mediaType === 'video') cids.current.cam = await engine.publishCamera();
    },
    [engine],
  );

  const actions = useMemo<CallActions>(
    () => ({
      placeCall: async (calleeIds, mediaType, isGroup = false): Promise<void> => {
        dispatch({ type: 'callPlaced', calleeIds, mediaType, isGroup });
        await engine.call(calleeIds, mediaType, isGroup);
      },
      joinMeeting: async (roomId, roomToken): Promise<void> => {
        dispatch({ type: 'meetingJoined', roomId, nowMs: Date.now() });
        await engine.joinRoom(roomId, roomToken);
        await publishFor('video');
        dispatch({ type: 'setCamera', on: true });
      },
      accept: async (): Promise<void> => {
        await engine.accept();
      },
      reject: async (): Promise<void> => {
        await engine.reject();
      },
      end: async (): Promise<void> => {
        /*
          红按钮在四种场合是四个不同的动作，**分辨这件事是 uikit 的责任**：
          让调用方去分辨，迟早有人分辨错。

          最容易错的是最后一条：**会议房里没有 call**，发 hangup 会被通话机
          本地拒成 2005 —— 按钮点了毫无反应、人退不出房间，而宿主只看到一条
          没头没尾的 error。（三人会议实测：三端都卡在房里出不来。）
        */
        if (state.isMeeting) return engine.leaveRoom();
        // 接通前只能 cancel，接通后只能 hangup——服务端会拒掉用错的那个。
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
        const on = !state.self.cameraOn;
        dispatch({ type: 'setCamera', on });
        // 第一次开摄像头要真的发布；之后只是开关，**不走 unpublish**——
        // 反复 publish/unpublish 会触发重协商风暴（协议 §3.2）。
        if (cids.current.cam === '' && on) cids.current.cam = await engine.publishCamera();
        else if (cids.current.cam !== '') await engine.setMuted(cids.current.cam, !on);
      },
      setMinimized: (minimized): void => dispatch({ type: 'setMinimized', minimized }),
      dismiss: (): void => dispatch({ type: 'dismiss' }),
    }),
    [engine, publishFor, state.phase, state.isMeeting, state.self.micOn, state.self.cameraOn],
  );

  /*
    callBegin 之后发布本端媒体。**不能放进 actions**：被叫方的 callBegin
    是事件驱动的，没有对应的用户动作。

    触发条件看的是**「有房间号且还没为它发布过」**，不是「阶段正好是 connecting」——
    connecting 可能一帧都不停留：callBegin 与 roomJoined 落在同一批更新里时，
    React 合并成一次提交，effect 看到的就直接是 active 了。
    （这条是 jsdom 用例抓出来的：现实里两个事件同一 tick 到达完全正常。）
  */
  const publishedRoomId = useRef('');
  useEffect(() => {
    const isLive = state.phase === 'connecting' || state.phase === 'active';
    if (!isLive || state.roomId === '' || publishedRoomId.current === state.roomId) return;
    publishedRoomId.current = state.roomId;
    if (state.isMeeting) return; // 会议由 joinMeeting 自己推流
    void publishFor(state.mediaType);
  }, [state.phase, state.roomId, state.isMeeting, state.mediaType, publishFor]);

  const value = useMemo<CallContextValue>(() => ({ state, engine, actions }), [state, engine, actions]);
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

/**
 * subscribe 把 engine 事件接到 reducer 上，返回退订函数。
 *
 * 写成模块级函数而不是 effect 里的一大坨：这样退订是**一次性收集**的，
 * 漏掉某个 off 不会悄悄泄漏（CONVENTIONS §5 的「成对清理」）。
 */
function subscribe(engine: CallEngine, dispatch: (action: ViewAction) => void): () => void {
  const off = [
    engine.on('callReceived', (e) =>
      dispatch({ type: 'callReceived', callId: e.callId, caller: e.caller,
        mediaType: e.mediaType, isGroup: e.isGroup })),
    engine.on('callBegin', (e) =>
      dispatch({ type: 'callBegin', callId: e.callId, roomId: e.roomId, mediaType: e.mediaType,
        isGroup: e.isGroup, role: e.role, nowMs: Date.now() })),
    engine.on('callEnd', (e) => dispatch({ type: 'callEnd', reason: e.reason })),
    engine.on('userEnter', (e) => dispatch({ type: 'userEnter', uid: e.uid })),
    engine.on('userLeave', (e) => dispatch({ type: 'userLeave', uid: e.uid })),
    engine.on('userAccept', (e) => dispatch({ type: 'userAccept', uid: e.uid })),
    engine.on('userAudioAvailable', (e) =>
      dispatch({ type: 'userAudio', uid: e.uid, available: e.available })),
    engine.on('userVideoAvailable', (e) =>
      dispatch({ type: 'userVideo', uid: e.uid, available: e.available })),
    engine.on('activeSpeakers', (e) => dispatch({ type: 'activeSpeakers', speakers: e.speakers })),
    engine.on('networkQuality', (e) => dispatch({ type: 'networkQuality', entries: e.entries })),
    // 四个便利事件只在 1v1 抛，随后必有 callEnd——所以这里只做提示，不改阶段。
    engine.on('callRejected', (e) => dispatch({ type: 'hint', text: `${e.uid} 已拒接` })),
    engine.on('callBusy', (e) => dispatch({ type: 'hint', text: `${e.uid} 忙线中` })),
    engine.on('callNoAnswer', (e) => dispatch({ type: 'hint', text: `${e.uid} 无应答` })),
    engine.on('callCancelled', (e) => dispatch({ type: 'hint', text: `${e.by} 取消了呼叫` })),
    engine.on('handledOnOtherDevice', (e) =>
      dispatch({ type: 'hint', text: `已在其他设备${e.action === 'accept' ? '接听' : '处理'}` })),
    engine.on('firstVideoFrame', () => dispatch({ type: 'mediaReady' })),
    engine.on('roomJoined', () => dispatch({ type: 'mediaReady' })),
    /*
      会议的收尾。**必须订阅这两个**，否则离房成功了界面还挂在那儿——
      会议没有 `callEnd`（那是振铃通话的出口），漏掉这两条就等于没有出口。
      `roomClosed` 也算：服务端单方面关房时同样得把界面收掉。
    */
    engine.on('roomLeft', () => dispatch({ type: 'roomLeft' })),
    engine.on('roomClosed', () => dispatch({ type: 'roomLeft' })),
  ];
  return () => {
    for (const unsubscribe of off) unsubscribe();
  };
}
