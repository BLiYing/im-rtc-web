import { describe, expect, it } from 'vitest';

import { ErrorCode, RtcError } from '../src/errors.js';
import { handshakeGiveUpReason } from '../src/signaling/handshakeGiveUp.js';

/**
 * 这里钉的是**判据本身**，不摆假服务端。
 *
 * `connection.test.ts` 那批走的是真时序（重连、不再重连），能覆盖主干；
 * 但有两条分支在那套装置里造不出来——local 组里可重试的那些码，
 * 以及「未知码而帧上压根没带 `retryable`」。它们恰恰是最容易改坏的两条。
 */
describe('握手放弃判据', () => {
  it('local 组一概不算服务端的裁决 —— 不管它 retryable 是什么', () => {
    // 2005 invalid_state：宿主 logout 时用来结掉在飞握手的那个，retryable=false。
    expect(handshakeGiveUpReason(new RtcError(ErrorCode.invalidState))).toBeNull();
    // 2003 / 2004：断线与超时，本来就该重连。
    expect(handshakeGiveUpReason(new RtcError(ErrorCode.networkUnreachable))).toBeNull();
    expect(handshakeGiveUpReason(new RtcError(ErrorCode.signalingTimeout))).toBeNull();
  });

  it('未知码而帧上没带 retryable：当可重试处理，维持「不认识就先退避着」', () => {
    expect(handshakeGiveUpReason(new RtcError(9999))).toBeNull();
  });

  it('未知码按帧上那一位走', () => {
    expect(handshakeGiveUpReason(new RtcError(9999, { wireRetryable: false }))).toBe(
      'configRejected',
    );
    expect(handshakeGiveUpReason(new RtcError(9999, { wireRetryable: true }))).toBeNull();
  });

  it('认识的码不许被线路上那一位盖掉 —— 表是一致性向量，线路不是', () => {
    // 1004 在表里是 retryable=false；哪怕对端胡说 true，也照样放弃。
    expect(handshakeGiveUpReason(new RtcError(ErrorCode.badParams, { wireRetryable: true }))).toBe(
      'configRejected',
    );
    // 1102 在表里是 retryable=true；对端说 false 也不该把它停掉。
    expect(
      handshakeGiveUpReason(new RtcError(ErrorCode.tokenExpired, { wireRetryable: false })),
    ).toBeNull();
  });

  it('不是 RtcError 的东西一律不放弃', () => {
    expect(handshakeGiveUpReason(new Error('boom'))).toBeNull();
    expect(handshakeGiveUpReason(undefined)).toBeNull();
  });
});
