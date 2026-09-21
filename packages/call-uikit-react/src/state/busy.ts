import type { CallViewState } from './viewTypes.js';
import { t } from '../i18n/index.js';

/** 已在一场里又想开始新的一场时的提示。 */
export const busyNotice = (): string => t('busy.notice');

/**
 * 此刻能不能开始**新的一场**（拨出 / 主动加入 / 进会议房）：只有界面空闲、或停在上一通的结束画面时才行。
 *
 * **三个入口共用这一条判据**（2026-09-19 真机，Android）：1v1 通话中收成小窗、回宿主去发起群通话，
 * `placeCall` 一进来就把界面状态换成「拨出中」，engine 随后把这次调用拒成 2005，Kit 对 2005 一声不吭——
 * 通话还连着、界面却是另一通，没有任何提示。`joinCall` 早有这道守门，`placeCall` 与 `joinMeeting` 漏了。
 */
export function newCallAllowed(phase: CallViewState['phase']): boolean {
  return phase === 'idle' || phase === 'ended';
}
