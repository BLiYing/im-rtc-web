import { ErrorCode, RtcError } from '../errors.js';
import type { Envelope } from './envelope.js';
import { OK_SUFFIX, okType } from './envelope.js';
import { decodeFields, encodeFields } from './fieldSpec.js';
import type { FrameData, FrameFields } from './fieldSpec.js';
import * as call from './frames.call.js';
import * as room from './frames.room.js';
import * as sys from './frames.sys.js';

/**
 * 帧类型注册表，对应 RTC_PROTOCOL.md 附录 A 的帧索引。
 *
 * 「加一个帧」的完整动作是：改协议文档 → 改 conformance 向量 → 在这里注册 → 四仓跟进。
 * 顺序不许颠倒（§9）。
 */

/** FrameType 是全部帧类型的常量表。命名规则见 §2.3：`<域>.<动作>[.ok]`。 */
export const FrameType = {
  hello: 'sys.hello',
  helloOk: 'sys.hello.ok',
  ping: 'sys.ping',
  pong: 'sys.pong',
  error: 'sys.error',

  roomJoin: 'room.join',
  roomLeave: 'room.leave',
  roomPublish: 'room.publish',
  roomUnpublish: 'room.unpublish',
  roomMute: 'room.mute',
  roomSubscribe: 'room.subscribe',
  roomUnsubscribe: 'room.unsubscribe',
  roomUpdateLayer: 'room.update_layer',
  roomOffer: 'room.offer',
  roomAnswer: 'room.answer',
  roomIceCandidate: 'room.ice_candidate',

  roomParticipantJoined: 'room.participant_joined',
  roomParticipantLeft: 'room.participant_left',
  roomTrackPublished: 'room.track_published',
  roomTrackUnpublished: 'room.track_unpublished',
  roomTrackMuted: 'room.track_muted',
  roomActiveSpeakers: 'room.active_speakers',
  roomQuality: 'room.quality',
  roomClosed: 'room.closed',

  callInvite: 'call.invite',
  callAccept: 'call.accept',
  callReject: 'call.reject',
  callCancel: 'call.cancel',
  callHangup: 'call.hangup',
  callInviteMore: 'call.invite_more',
  callJoin: 'call.join',

  callIncoming: 'call.incoming',
  callRinging: 'call.ringing',
  callAccepted: 'call.accepted',
  callRejected: 'call.rejected',
  callBusy: 'call.busy',
  callNoAnswer: 'call.no_answer',
  callCancelled: 'call.cancelled',
  callConnected: 'call.connected',
  callHandledElsewhere: 'call.handled_elsewhere',
  callEnded: 'call.ended',
} as const;

/**
 * REQUEST_TYPES 是全部上行请求帧。请求必须带非空 req_id，且**恰好**有一条应答。
 *
 * room.offer / answer / ice_candidate 不在这张表里——它们是双向的，
 * 「谁是请求方」由 pc 字段决定（§3.3），不由 type 决定。
 */
export const REQUEST_TYPES: readonly string[] = [
  FrameType.hello,
  FrameType.ping,
  FrameType.roomJoin,
  FrameType.roomLeave,
  FrameType.roomPublish,
  FrameType.roomUnpublish,
  FrameType.roomMute,
  FrameType.roomSubscribe,
  FrameType.roomUnsubscribe,
  FrameType.roomUpdateLayer,
  FrameType.callInvite,
  FrameType.callAccept,
  FrameType.callReject,
  FrameType.callCancel,
  FrameType.callHangup,
  FrameType.callInviteMore,
  FrameType.callJoin,
];

/**
 * RESERVED_TYPES 是 §3.6 的会议层留位帧：**已占名但 v1 不实现**。
 * 客户端不该发它们；收到服务端的 1003 时要能分清「将来会有」与「压根没有」。
 */
export const RESERVED_TYPES: readonly string[] = [
  'room.mute_participant',
  'room.kick',
  'room.lock',
  'room.raise_hand',
  'room.participant_muted',
  'room.participant_kicked',
  'room.hand_raised',
  'room.locked',
];

const REQUEST_SET = new Set(REQUEST_TYPES);
const RESERVED_SET = new Set(RESERVED_TYPES);

/** isRequestType 报告这个 type 是不是上行请求帧。 */
export function isRequestType(type: string): boolean {
  return REQUEST_SET.has(type);
}

/** isReservedType 报告这个 type 是不是已占名但未实现的会议层帧。 */
export function isReservedType(type: string): boolean {
  return RESERVED_SET.has(type);
}

const REGISTRY: Readonly<Record<string, FrameFields>> = {
  [FrameType.hello]: sys.HELLO_FIELDS,
  [FrameType.helloOk]: sys.HELLO_OK_FIELDS,
  [FrameType.ping]: sys.EMPTY_FIELDS,
  [FrameType.pong]: sys.EMPTY_FIELDS,
  [FrameType.error]: sys.ERROR_FIELDS,

  [FrameType.roomJoin]: room.JOIN_FIELDS,
  [FrameType.roomLeave]: room.LEAVE_FIELDS,
  [FrameType.roomPublish]: room.PUBLISH_FIELDS,
  [FrameType.roomUnpublish]: room.TRACK_ID_FIELDS,
  [FrameType.roomMute]: room.MUTE_FIELDS,
  [FrameType.roomSubscribe]: room.LAYER_FIELDS,
  [FrameType.roomUnsubscribe]: room.TRACK_ID_FIELDS,
  [FrameType.roomUpdateLayer]: room.LAYER_FIELDS,
  [FrameType.roomOffer]: room.SDP_FIELDS,
  [FrameType.roomAnswer]: room.SDP_FIELDS,
  [FrameType.roomIceCandidate]: room.ICE_FIELDS,

  [FrameType.roomParticipantJoined]: room.PARTICIPANT_JOINED_FIELDS,
  [FrameType.roomParticipantLeft]: room.PARTICIPANT_LEFT_FIELDS,
  [FrameType.roomTrackPublished]: room.TRACK_PUBLISHED_FIELDS,
  [FrameType.roomTrackUnpublished]: room.TRACK_UNPUBLISHED_FIELDS,
  [FrameType.roomTrackMuted]: room.TRACK_MUTED_FIELDS,
  [FrameType.roomActiveSpeakers]: room.ACTIVE_SPEAKERS_FIELDS,
  [FrameType.roomQuality]: room.QUALITY_FIELDS,
  [FrameType.roomClosed]: room.ROOM_CLOSED_FIELDS,

  [FrameType.callInvite]: call.INVITE_FIELDS,
  [FrameType.callAccept]: call.CALL_ID_FIELDS,
  [FrameType.callReject]: call.CALL_ID_FIELDS,
  [FrameType.callCancel]: call.CALL_ID_FIELDS,
  [FrameType.callHangup]: call.CALL_ID_FIELDS,
  [FrameType.callInviteMore]: call.INVITE_MORE_FIELDS,
  [FrameType.callJoin]: call.CALL_ID_FIELDS,

  [FrameType.callIncoming]: call.INCOMING_FIELDS,
  [FrameType.callRinging]: call.RINGING_FIELDS,
  [FrameType.callAccepted]: call.MEMBER_OUTCOME_FIELDS,
  [FrameType.callRejected]: call.MEMBER_OUTCOME_FIELDS,
  [FrameType.callBusy]: call.MEMBER_OUTCOME_FIELDS,
  [FrameType.callNoAnswer]: call.MEMBER_OUTCOME_FIELDS,
  [FrameType.callCancelled]: call.CANCELLED_FIELDS,
  [FrameType.callConnected]: call.CONNECTED_FIELDS,
  [FrameType.callHandledElsewhere]: call.HANDLED_ELSEWHERE_FIELDS,
  [FrameType.callEnded]: call.ENDED_FIELDS,
};

const OK_REGISTRY: Readonly<Record<string, FrameFields>> = {
  [okType(FrameType.hello)]: sys.HELLO_OK_FIELDS,
  [okType(FrameType.roomJoin)]: room.JOIN_OK_FIELDS,
  [okType(FrameType.roomPublish)]: room.PUBLISH_OK_FIELDS,
  [okType(FrameType.callInvite)]: call.INVITE_OK_FIELDS,
  // room.offer 没有 .ok —— pub 侧的 offer 由 room.answer 直接作为应答回来（§3.3）。
  [okType(FrameType.roomAnswer)]: sys.EMPTY_FIELDS,
  [okType(FrameType.roomIceCandidate)]: sys.EMPTY_FIELDS,
  [okType(FrameType.callAccept)]: sys.EMPTY_FIELDS,
  [okType(FrameType.callJoin)]: sys.EMPTY_FIELDS,
  [okType(FrameType.callInviteMore)]: sys.EMPTY_FIELDS,
};

/**
 * lookupFrame 返回某帧类型的字段声明。
 *
 * 请求帧的 .ok 如果没单独登记，一律给空对象——纯 ack 是常态，
 * 不必为每个 room.mute.ok 写一份声明。
 */
export function lookupFrame(type: string): FrameFields | undefined {
  const direct = REGISTRY[type] ?? OK_REGISTRY[type];
  if (direct !== undefined) return direct;
  if (type.endsWith(OK_SUFFIX)) {
    const base = type.slice(0, -OK_SUFFIX.length);
    if (isRequestType(base)) return sys.EMPTY_FIELDS;
  }
  return undefined;
}

/** knownFrameTypes 列出全部已注册的帧类型（不含自动派生的 .ok），供测试核对。 */
export function knownFrameTypes(): string[] {
  return [...Object.keys(REGISTRY), ...Object.keys(OK_REGISTRY)];
}

/**
 * decodeFrame 按 Envelope.type 解出帧数据。
 *
 * 未注册的 type 抛 unknown_type——但**客户端收到未知 type 时应当静默忽略**
 * （§2.3 前向兼容，服务端可能比客户端新），别把这个错误抛给宿主。
 */
export function decodeFrame(envelope: Envelope): Record<string, unknown> {
  const fields = lookupFrame(envelope.type);
  if (fields === undefined) {
    throw new RtcError(ErrorCode.unknownType, {
      forType: envelope.type,
      cause: new Error(`未注册的帧 "${envelope.type}"`),
    });
  }
  return decodeFields(fields, envelope.data);
}

/**
 * newFrameData 返回某帧**已填好协议默认值**的数据对象。
 *
 * # 发送方必须用它
 *
 * 「可选字段用省略表达，接收方按默认值填」（§2.4 规则 2）只对**省略**成立。
 * 而 JSON.stringify 会把显式的 false / 0 编码出去：直接写
 * `{ room_id: 'r-1' }` 少了 auto_subscribe，写 `{ ..., auto_subscribe: false }`
 * 又把默认的 true 覆盖成了 false。两种写法都会让人进了房收不到任何流。
 *
 * 三端同理（Go 的结构体零值、Swift 的 Codable）。**发送侧一律从这里开始改字段。**
 */
export function newFrameData<F extends FrameFields>(fields: F): FrameData<F> {
  return decodeFields(fields, {});
}

/** encodeFrame 把帧数据映射回线路上的 snake_case data。 */
export function encodeFrame<F extends FrameFields>(
  fields: F,
  value: FrameData<F>,
): Record<string, unknown> {
  return encodeFields(fields, value);
}
