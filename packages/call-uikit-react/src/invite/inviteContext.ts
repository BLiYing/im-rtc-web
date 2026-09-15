import type { CallEngine } from '@im-rtc/call-engine';

import { inviteSlotsLeft } from '../state/callView.js';
import type { CallViewState } from '../state/viewTypes.js';
import type { InviteContext } from './types.js';

/**
 * buildInviteContext 把此刻的通话视图状态拼成一份 {@link InviteContext}，交给
 * `inviteProvider` / `onInviteRequest` / `canInvite`（HOST_INTEGRATION_DESIGN §3.4）。
 *
 * 单独一个函数是因为它要拼三处会用到的同一份东西：「加人」按钮的 `canInvite` 判断、
 * 打开选人页时的 provider 调用、宿主接管页的 `onInviteRequest` 调用——
 * 三处各拼一遍的话，字段漏一个只会在其中一处被发现。
 */
export function buildInviteContext(engine: CallEngine, state: CallViewState): InviteContext {
  return {
    callId: state.callId,
    chatGroupId: state.chatGroupId,
    userData: state.userData,
    callerUid: state.callerUid,
    mediaType: state.mediaType,
    // 含自己：宿主的 provider 常按「已经占了几个位子」做本地过滤。
    participantUids: [engine.uid, ...state.participants.map((p) => p.uid)],
    slotsLeft: inviteSlotsLeft(state),
  };
}
