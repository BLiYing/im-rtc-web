import type { CallEngine } from 'im-rtc-call-engine';

import type { ViewAction } from './state/viewTypes.js';
import { t } from './i18n/index.js';

/**
 * subscribeEngine 把 engine 事件接到 reducer 上，返回退订函数。
 *
 * 写成模块级函数而不是 effect 里的一大坨：这样退订是**一次性收集**的，
 * 漏掉某个 off 不会悄悄泄漏（CONVENTIONS §5 的「成对清理」）。
 *
 * **这一整个文件里没有一处「内部 API」**：uikit 与「宿主自画 UI」拿到的信息完全一致。
 */
export function subscribeEngine(engine: CallEngine, dispatch: (action: ViewAction) => void): () => void {
  const off = [
    engine.on('callReceived', (e) =>
      // 名单里含自己，摆格子之前先去掉——「自己」不是远端成员。
      dispatch({ type: 'callReceived', callId: e.callId, caller: e.caller, inviter: e.inviter, selfUid: engine.uid,
        calleeIds: e.calleeIds.filter((uid) => uid !== engine.uid),
        joinedIds: (e.joinedIds ?? []).filter((uid) => uid !== engine.uid),
        mediaType: e.mediaType, isGroup: e.isGroup,
        chatGroupId: e.chatGroupId, userData: e.userData })),
    engine.on('callBegin', (e) =>
      dispatch({ type: 'callBegin', callId: e.callId, roomId: e.roomId, mediaType: e.mediaType,
        isGroup: e.isGroup, role: e.role, nowMs: Date.now(),
        caller: e.caller, chatGroupId: e.chatGroupId, userData: e.userData })),
    // 时长用服务端给的那个（不变量 I8：四端禁止自己算）。
    engine.on('callEnd', (e) => dispatch({ type: 'callEnd', reason: e.reason, durationSec: e.durationSec })),
    engine.on('userEnter', (e) => dispatch({ type: 'userEnter', uid: e.uid })),
    engine.on('userLeave', (e) => dispatch({ type: 'userLeave', uid: e.uid })),
    // 通话里任何人加的人开始响铃都会来（协议 call.ringing 发在场全员），不只是本端加的。
    engine.on('userRinging', (e) => dispatch({ type: 'userRinging', uid: e.uid })),
    engine.on('userAccept', (e) => dispatch({ type: 'userAccept', uid: e.uid })),
    /*
      拒接与无应答要在格子上写明终局再收掉——直接收的话，从主叫的角度看，
      对方拒接就跟什么都没发生一样。
      1v1 也会抛这两条，但那边紧跟着就是 callEnd，界面整个收走，标不标无所谓；
      **群通话里才是唯一的信号**——那边只有 onUser*，没有便利事件（不变量 I7）。
    */
    engine.on('userReject', (e) => dispatch({ type: 'userSettled', uid: e.uid, outcome: 'rejected' })),
    engine.on('userNoResponse', (e) => dispatch({ type: 'userSettled', uid: e.uid, outcome: 'no_answer' })),
    engine.on('userAudioAvailable', (e) =>
      dispatch({ type: 'userAudio', uid: e.uid, available: e.available })),
    engine.on('userVideoAvailable', (e) =>
      dispatch({ type: 'userVideo', uid: e.uid, available: e.available })),
    engine.on('activeSpeakers', (e) =>
      dispatch({ type: 'activeSpeakers', speakers: e.speakers, selfUid: engine.uid })),
    engine.on('networkQuality', (e) => dispatch({ type: 'networkQuality', entries: e.entries })),
    // 四个便利事件只在 1v1 抛，随后必有 callEnd——所以这里只做提示，不改阶段。
    engine.on('callRejected', (e) => dispatch({ type: 'hint', text: t('hint.peerRejected', { uid: e.uid }) })),
    engine.on('callBusy', (e) => dispatch({ type: 'hint', text: t('hint.peerBusy', { uid: e.uid }) })),
    engine.on('callNoAnswer', (e) => dispatch({ type: 'hint', text: t('hint.peerNoAnswer', { uid: e.uid }) })),
    engine.on('callCancelled', (e) => dispatch({ type: 'hint', text: t('hint.peerCancelled', { uid: e.uid }) })),
    // 通话中有人打进来，服务端已经替我们回了忙线——**只提示，不动当前通话**。
    engine.on('callMissed', (e) => dispatch({ type: 'hint', text: t('hint.missedBusy', { uid: e.caller }) })),
    // 他设备处理了：来电页会随后收到 callEnd 而静默消失，这里不弹提示（交互稿 §06）。
    engine.on('handledOnOtherDevice', () => undefined),
    engine.on('firstVideoFrame', (e) => {
      dispatch({ type: 'mediaReady' });
      // 对端开摄像头后新画面上屏，揭开他的格子（见 RemoteParticipant.isVideoPending）。
      dispatch({ type: 'videoRevealed', uid: e.uid });
    }),
    engine.on('roomJoined', (e) => {
      if (e.uids) dispatch({ type: 'roomSnapshot', uids: e.uids }); // 老引擎不带快照就不对账
      dispatch({ type: 'mediaReady' });
    }),
    /*
      会议的收尾。**必须订阅这两个**，否则离房成功了界面还挂在那儿——
      会议没有 `callEnd`（那是振铃通话的出口），漏掉这两条就等于没有出口。
    */
    engine.on('roomLeft', () => dispatch({ type: 'roomLeft' })),
    engine.on('roomClosed', () => dispatch({ type: 'roomLeft' })),
    // 顶部橙条：正在重连 / 连接已断开（规范 §08）。通话不结束、计时器继续走。
    engine.on('connected', () => dispatch({ type: 'connection', status: 'ok' })),
    engine.on('disconnected', (e) =>
      dispatch({ type: 'connection', status: e.willReconnect ? 'reconnecting' : 'lost' })),
    engine.on('kickedOut', () => dispatch({ type: 'connection', status: 'lost' })),
  ];
  return () => {
    for (const unsubscribe of off) unsubscribe();
  };
}
