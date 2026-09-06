import type { CallEngine } from '@im-rtc/call-engine';
import type { ReactNode } from 'react';
import { createContext, useEffect, useMemo, useReducer, useRef } from 'react';

import { endedHoldMs as holdMsFor } from './format/endReason.js';
import { initialCallView, reduceCallView } from './state/callView.js';
import type { CallViewState } from './state/callView.js';
import type { PermissionQuery } from './state/permissions.js';
import { browserPermissionQuery } from './state/permissions.js';
import { subscribeEngine } from './subscribeEngine.js';
import { callMotion } from './theme.js';
import type { CallActions, PublishedCids } from './useCallActions.js';
import { useCallActions } from './useCallActions.js';
import type { PermissionPromptView } from './usePermissionGate.js';
import { usePermissionGate } from './usePermissionGate.js';

export type { CallActions } from './useCallActions.js';

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

/** InviteCandidate 是宿主给的「可以邀请的人」。uikit 不内置联系人系统（CONVENTIONS §11）。 */
export interface InviteCandidate {
  readonly uid: string;
  readonly name?: string;
  readonly isOnline?: boolean;
}

/** CallContextValue 是 context 里的东西。 */
export interface CallContextValue {
  readonly state: CallViewState;
  readonly engine: CallEngine;
  readonly actions: CallActions;
  /** 正在显示的权限说明 / 被拒卡；null = 没有。 */
  readonly prompt: PermissionPromptView | null;
  /** 「添加成员」的候选名单。 */
  readonly candidates: readonly InviteCandidate[];
}

export const CallContext = createContext<CallContextValue | null>(null);

/** CallProviderProps 是 Provider 的参数。 */
export interface CallProviderProps {
  readonly engine: CallEngine;
  readonly children: ReactNode;
  /** 结束画面停留多久再自动收起。默认按原因分档（`format/endReason.ts`）。0 = 不自动收。 */
  readonly endedHoldMs?: number;
  /** 群通话里「添加成员」的候选名单。不给就退化成 uid 输入框。 */
  readonly inviteCandidates?: readonly InviteCandidate[];
  /** 权限状态查询。默认走浏览器 `navigator.permissions`；测试可注入。 */
  readonly permissionQuery?: PermissionQuery;
}

/** 结束画面的默认停留时长。见 `format/endReason.ts`：实际时长按原因分档。 */
const DEFAULT_ENDED_HOLD_MS = 1500;
const NO_CANDIDATES: readonly InviteCandidate[] = [];

export function CallProvider({
  engine, children, endedHoldMs = DEFAULT_ENDED_HOLD_MS,
  inviteCandidates = NO_CANDIDATES, permissionQuery = browserPermissionQuery,
}: CallProviderProps): ReactNode {
  const [state, dispatch] = useReducer(reduceCallView, initialCallView);
  const cids = useRef<PublishedCids>({ mic: '', cam: '' });
  const gate = usePermissionGate(engine, dispatch, permissionQuery);
  const { actions, publishFor } = useCallActions({ engine, state, dispatch, cids, gate });

  useEffect(() => subscribeEngine(engine, dispatch), [engine]);

  // 结束画面停留一会儿再收起。**计时器必须清理**，否则快速连打两通会互相收掉。
  useEffect(() => {
    if (state.phase !== 'ended' || endedHoldMs <= 0) return;
    const hold = endedHoldMs === DEFAULT_ENDED_HOLD_MS ? holdMsFor(state.endReason) : endedHoldMs;
    const timer = setTimeout(() => dispatch({ type: 'dismiss' }), hold);
    return () => clearTimeout(timer);
  }, [state.phase, state.endReason, endedHoldMs]);

  // 通话结束时清掉发布记录，下一通才不会拿着上一通的 cid 去 mute。
  useEffect(() => {
    if (state.phase === 'idle') cids.current = { mic: '', cam: '' };
  }, [state.phase]);

  /*
    提示（「通话已满员」「对方已拒接」）**停几秒就撤**。它在 `statusLine` 里优先于时长，
    不撤的话计时器从此再也不出现（规范 §08：这些是 toast，不是常驻状态）。
  */
  useEffect(() => {
    if (state.hint === '') return;
    const text = state.hint;
    const timer = setTimeout(() => dispatch({ type: 'hintExpired', text }), callMotion.hintHoldMs);
    return () => clearTimeout(timer);
  }, [state.hint]);

  /*
    邀请中的格子拿到终局（已拒绝 / 未接听）后停 2s 再收（交互稿 §05 G3）。
    **依赖看的是内容签名，不是 length**（CONVENTIONS §5）——定长时 length 不变，effect 永远不重跑。

    **计时器按 uid 各算各的**，放 ref 不进 effect 的清理：原先整批一起建、一起清，
    第二个人拒接时会把第一个人的 2 秒重新计一遍——先拒的那格反而留得更久。
  */
  const settledTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const settledUids = state.participants.filter((p) => p.settled !== '').map((p) => p.uid).join(',');
  useEffect(() => {
    const wanted = new Set(settledUids === '' ? [] : settledUids.split(','));
    const timers = settledTimers.current;
    for (const [uid, timer] of timers) {
      // 人已经被收掉（或重新接听了）：撤掉他的计时器。
      if (!wanted.has(uid)) {
        clearTimeout(timer);
        timers.delete(uid);
      }
    }
    for (const uid of wanted) {
      if (timers.has(uid)) continue;
      timers.set(uid, setTimeout(() => {
        timers.delete(uid);
        dispatch({ type: 'userRemove', uid });
      }, callMotion.settledHoldMs));
    }
  }, [settledUids]);

  // 卸载时把还没到点的终局计时器清干净（CONVENTIONS §5：成对清理）。
  useEffect(() => () => {
    for (const timer of settledTimers.current.values()) clearTimeout(timer);
    settledTimers.current.clear();
  }, []);

  /*
    callBegin 之后发布本端媒体。**不能放进 actions**：被叫方的 callBegin
    是事件驱动的，没有对应的用户动作。

    触发条件看的是**「有房间号且还没为它发布过」**，不是「阶段正好是 connecting」——
    connecting 可能一帧都不停留：callBegin 与 roomJoined 落在同一批更新里时，
    React 合并成一次提交，effect 看到的就直接是 active 了。
  */
  const publishedRoomId = useRef('');
  useEffect(() => {
    const isLive = state.phase === 'connecting' || state.phase === 'active';
    if (!isLive || state.roomId === '' || publishedRoomId.current === state.roomId) return;
    publishedRoomId.current = state.roomId;
    if (state.isMeeting) return; // 会议由 joinMeeting 自己推流
    void publishFor(state.mediaType, state.self.cameraOn);
  }, [state.phase, state.roomId, state.isMeeting, state.mediaType, state.self.cameraOn, publishFor]);

  /*
    **关掉标签页尽量挂断**（交互稿 §03）：`beforeunload` 里把结束帧发出去，对端能立刻收到。

    **但这是尽力而为，不是保证**：文档正在拆的时候异步的 WS 发送经常来不及冲出去。
    真正兜底的是服务端那边的连接关闭检测——它本来就会把这通电话结束掉。
    所以**不调 `preventDefault()`**：那会让每一次刷新都弹一个「离开此网站？」，
    换来的却只是同一个不保证的发送。
  */
  const isLive = state.phase === 'connecting' || state.phase === 'active' || state.phase === 'outgoing';
  const endRef = useRef(actions.end);
  endRef.current = actions.end;
  useEffect(() => {
    if (!isLive || typeof window === 'undefined') return;
    const onUnload = (): void => {
      void endRef.current();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [isLive]);

  const value = useMemo<CallContextValue>(
    () => ({ state, engine, actions, prompt: gate.prompt, candidates: inviteCandidates }),
    [state, engine, actions, gate.prompt, inviteCandidates],
  );
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
