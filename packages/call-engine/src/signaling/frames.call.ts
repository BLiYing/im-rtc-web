import {
  DEFAULT_TIMEOUT_SEC,
  HANDLED_ACTIONS,
  MAX_TIMEOUT_SEC,
  MEDIA_TYPES,
  MIN_TIMEOUT_SEC,
  REASONS,
} from './enums.js';
import type { FrameFields } from './fieldSpec.js';

/**
 * call 域：振铃流程。见 RTC_PROTOCOL.md §4。
 * Call 层**不碰媒体**——接通后一切走 room 帧。所以这里没有一个 SDP 字段。
 */

/**
 * INVITE_FIELDS：发起通话。
 *
 * user_data 是 opaque **字符串**不是对象——宿主要塞任意结构自己序列化。
 * 这条是为了 C++ 端不必处理任意嵌套（§2.4 规则 5）。服务端原样透传，不解析。
 */
export const INVITE_FIELDS = {
  /** 1v1 恰好 1 个；群 ≤8（房内含主叫共 9 人）。 */
  calleeIds: { kind: 'stringArray', wire: 'callee_ids' },
  mediaType: { kind: 'enum', wire: 'media_type', values: MEDIA_TYPES, fallback: 'audio' },
  isGroup: { kind: 'bool', wire: 'is_group' },
  /** '' = 服务端建房。 */
  roomId: { kind: 'string', wire: 'room_id' },
  timeoutSec: {
    kind: 'int',
    wire: 'timeout_sec',
    default: DEFAULT_TIMEOUT_SEC,
    min: MIN_TIMEOUT_SEC,
    max: MAX_TIMEOUT_SEC,
  },
  userData: { kind: 'string', wire: 'user_data' },
} as const satisfies FrameFields;

/** INVITE_OK_FIELDS：**主叫此时禁止 room.join**——接听前不进 SFU（§4.1）。 */
export const INVITE_OK_FIELDS = {
  callId: { kind: 'string', wire: 'call_id' },
  roomId: { kind: 'string', wire: 'room_id' },
  invitedAtMs: { kind: 'int', wire: 'invited_at_ms' },
} as const satisfies FrameFields;

/**
 * CALL_ID_FIELDS：只带 call_id 的上行帧共用
 * （accept / reject / cancel / hangup / join）。
 *
 * 接通后主叫也用 hangup，**不用 cancel**——两个词不共用一条路径，
 * 避免「取消一通已接通的电话」这种歧义。
 */
export const CALL_ID_FIELDS = {
  callId: { kind: 'string', wire: 'call_id' },
} as const satisfies FrameFields;

/** INVITE_MORE_FIELDS：群通话中途加邀（P4）。仅主叫可发。 */
export const INVITE_MORE_FIELDS = {
  callId: { kind: 'string', wire: 'call_id' },
  calleeIds: { kind: 'stringArray', wire: 'callee_ids' },
} as const satisfies FrameFields;

/** INCOMING_FIELDS：被叫收到的邀请，对应 onCallReceived。 */
export const INCOMING_FIELDS = {
  callId: { kind: 'string', wire: 'call_id' },
  roomId: { kind: 'string', wire: 'room_id' },
  caller: { kind: 'string', wire: 'caller' },
  calleeIds: { kind: 'stringArray', wire: 'callee_ids' },
  mediaType: { kind: 'enum', wire: 'media_type', values: MEDIA_TYPES, fallback: 'audio' },
  isGroup: { kind: 'bool', wire: 'is_group' },
  timeoutSec: {
    kind: 'int',
    wire: 'timeout_sec',
    default: DEFAULT_TIMEOUT_SEC,
    min: MIN_TIMEOUT_SEC,
    max: MAX_TIMEOUT_SEC,
  },
  invitedAtMs: { kind: 'int', wire: 'invited_at_ms' },
  userData: { kind: 'string', wire: 'user_data' },
} as const satisfies FrameFields;

/**
 * RINGING_FIELDS：告诉主叫「对方设备开始响铃了」，每个被叫 uid 只发一次。
 * UI 据此把「正在呼叫…」改成「等待对方接听…」。它**不对应任何回调**。
 */
export const RINGING_FIELDS = {
  callId: { kind: 'string', wire: 'call_id' },
  uid: { kind: 'string', wire: 'uid' },
  deviceCount: { kind: 'int', wire: 'device_count' },
} as const satisfies FrameFields;

/**
 * MEMBER_OUTCOME_FIELDS：某成员的裁决，四个帧共用
 * （call.accepted / rejected / busy / no_answer）。
 */
export const MEMBER_OUTCOME_FIELDS = {
  callId: { kind: 'string', wire: 'call_id' },
  uid: { kind: 'string', wire: 'uid' },
} as const satisfies FrameFields;

/** CANCELLED_FIELDS：主叫取消，发给全部被叫设备。 */
export const CANCELLED_FIELDS = {
  callId: { kind: 'string', wire: 'call_id' },
  by: { kind: 'string', wire: 'by' },
} as const satisfies FrameFields;

/**
 * CONNECTED_FIELDS：「可以进房了」，对应 onCallBegin。
 *
 * call.accept.ok 是纯 ack，房间信息只在这一条帧里——一个东西一条路径。
 */
export const CONNECTED_FIELDS = {
  callId: { kind: 'string', wire: 'call_id' },
  roomId: { kind: 'string', wire: 'room_id' },
  /** 绑定 (room_id, uid, device_id)，TTL 5 分钟、一次性。**不要整条打日志**。 */
  roomToken: { kind: 'string', wire: 'room_token' },
  mediaType: { kind: 'enum', wire: 'media_type', values: MEDIA_TYPES, fallback: 'audio' },
  isGroup: { kind: 'bool', wire: 'is_group' },
  /** 通话时长的起点，服务端时钟。 */
  connectedAtMs: { kind: 'int', wire: 'connected_at_ms' },
  acceptedBy: { kind: 'string', wire: 'accepted_by' },
} as const satisfies FrameFields;

/** HANDLED_ELSEWHERE_FIELDS：本账号另一台设备处理了这通电话。 */
export const HANDLED_ELSEWHERE_FIELDS = {
  callId: { kind: 'string', wire: 'call_id' },
  action: { kind: 'enum', wire: 'action', values: HANDLED_ACTIONS, fallback: 'accept' },
  deviceId: { kind: 'string', wire: 'device_id' },
} as const satisfies FrameFields;

/**
 * ENDED_FIELDS：**唯一终态帧**。
 *
 * 铁律：每个成员设备收到且仅收到一条；所有结局都走它；
 * 宿主只监听它也必须能完整记录一通电话。
 */
export const ENDED_FIELDS = {
  callId: { kind: 'string', wire: 'call_id' },
  roomId: { kind: 'string', wire: 'room_id' },
  reason: { kind: 'enum', wire: 'reason', values: REASONS, fallback: 'error' },
  /** 未接通恒为 0。**四端禁止自己算时长**（时钟偏移），一律用这个值。 */
  durationSec: { kind: 'int', wire: 'duration_sec' },
  /** 动作发起人 uid；服务端自行判定时为 ''。 */
  endedBy: { kind: 'string', wire: 'ended_by' },
  /**
   * 这通电话是谁打的。
   *
   * **忙线那条不振铃**，被叫拿到的第一帧也是最后一帧就是它——没有这个字段就说不出
   * 「谁来过电话」（协议 §4.2）。字段没登记在这里的话解码器会把它丢掉，
   * `onCallMissed` 拿到的 caller 就是空串。
   */
  caller: { kind: 'string', wire: 'caller' },
} as const satisfies FrameFields;
