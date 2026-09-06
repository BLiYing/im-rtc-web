import type { CallEngine } from '@im-rtc/call-engine';
import { ErrorCode } from '@im-rtc/call-engine';

import type { ViewAction } from './state/viewTypes.js';

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
      dispatch({ type: 'callReceived', callId: e.callId, caller: e.caller,
        mediaType: e.mediaType, isGroup: e.isGroup })),
    engine.on('callBegin', (e) =>
      dispatch({ type: 'callBegin', callId: e.callId, roomId: e.roomId, mediaType: e.mediaType,
        isGroup: e.isGroup, role: e.role, nowMs: Date.now() })),
    engine.on('callEnd', (e) => dispatch({ type: 'callEnd', reason: e.reason })),
    engine.on('userEnter', (e) => dispatch({ type: 'userEnter', uid: e.uid })),
    engine.on('userLeave', (e) => dispatch({ type: 'userLeave', uid: e.uid })),
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
    engine.on('activeSpeakers', (e) => dispatch({ type: 'activeSpeakers', speakers: e.speakers })),
    engine.on('networkQuality', (e) => dispatch({ type: 'networkQuality', entries: e.entries })),
    // 四个便利事件只在 1v1 抛，随后必有 callEnd——所以这里只做提示，不改阶段。
    engine.on('callRejected', (e) => dispatch({ type: 'hint', text: `${e.uid} 已拒接` })),
    engine.on('callBusy', (e) => dispatch({ type: 'hint', text: `${e.uid} 忙线中` })),
    engine.on('callNoAnswer', (e) => dispatch({ type: 'hint', text: `${e.uid} 无应答` })),
    engine.on('callCancelled', (e) => dispatch({ type: 'hint', text: `${e.by} 取消了呼叫` })),
    // 他设备处理了：来电页会随后收到 callEnd 而静默消失，这里不弹提示（交互稿 §06）。
    engine.on('handledOnOtherDevice', () => undefined),
    engine.on('firstVideoFrame', () => dispatch({ type: 'mediaReady' })),
    engine.on('roomJoined', () => dispatch({ type: 'mediaReady' })),
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
    /*
      加人的两条失败分支（交互稿 §05）：满员出 Toast；非主叫把入口藏掉。
      别的错误码这里不接——它们由宿主的日志 / 错误面板处理，界面上没有对应的态。
    */
    engine.on('error', (e) => {
      if (e.code === ErrorCode.roomFull) dispatch({ type: 'hint', text: '通话已满员（最多 9 人）' });
      else if (e.code === ErrorCode.notCallOwner) dispatch({ type: 'inviteDenied' });
    }),
  ];
  return () => {
    for (const unsubscribe of off) unsubscribe();
  };
}
