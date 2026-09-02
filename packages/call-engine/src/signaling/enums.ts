/**
 * 协议枚举：**封闭的小写字符串集合**（RTC_PROTOCOL.md §2.4 规则 6）。
 *
 * 每个枚举都配一个兜底值，收到集合外的值折成它——这是「新增枚举值不算破坏兼容」
 * （§10）成立的前提：服务端发一个老客户端不认识的值时，老客户端不能崩。
 *
 * 用 `as const` 数组 + 联合类型，不用 TS `enum`（CONVENTIONS §3）。
 */

/** MEDIA_TYPES：通话媒体类型。兜底 'audio'——宁可当语音，也不去开一个不存在的摄像头。 */
export const MEDIA_TYPES = ['audio', 'video'] as const;
/** MediaType 是 media_type 的取值。 */
export type MediaType = (typeof MEDIA_TYPES)[number];

/** REASONS：通话结束原因，与 reasons.ts 的 CallEndReason 同一份。兜底 'error'。 */
export const REASONS = [
  'hangup',
  'cancel',
  'reject',
  'no_answer',
  'busy',
  'offline',
  'answered_elsewhere',
  'rejected_elsewhere',
  'kicked',
  'room_closed',
  'network',
  'error',
] as const;

/** LAYERS：simulcast 层。'none' = 暂停下发但保留订阅。兜底 'l'——宁可给小图。 */
export const LAYERS = ['none', 'l', 'm', 'h'] as const;
/** Layer 是 max_layer 的取值。 */
export type Layer = (typeof LAYERS)[number];

/** TRACK_KINDS：Track 类型。 */
export const TRACK_KINDS = ['audio', 'video'] as const;
/** TrackKind 是 kind 的取值。 */
export type TrackKind = (typeof TRACK_KINDS)[number];

/** TRACK_SOURCES：Track 来源。同一 participant 同一 source 最多一条 Track。 */
export const TRACK_SOURCES = ['microphone', 'camera', 'screen', 'screen_audio'] as const;
/** TrackSource 是 source 的取值。 */
export type TrackSource = (typeof TRACK_SOURCES)[number];

/**
 * PC_ROLES：两条 PeerConnection。**每条的 offerer 是固定的**（§3.3）——
 * pub 由客户端 offer、sub 由服务端 offer。固定 offerer 就没有 glare，
 * 所以 engine 里不需要 perfect negotiation / rollback。
 */
export const PC_ROLES = ['pub', 'sub'] as const;
/** PcRole 是 pc 的取值。 */
export type PcRole = (typeof PC_ROLES)[number];

/** ROOM_KINDS：房间策略预设。 */
export const ROOM_KINDS = ['call_1v1', 'call_group', 'meeting'] as const;
/** RoomKind 是 room_kind 的取值。 */
export type RoomKind = (typeof ROOM_KINDS)[number];

/** HANDLED_ACTIONS：另一台设备做了什么。 */
export const HANDLED_ACTIONS = ['accept', 'reject'] as const;
/** HandledAction 是 action 的取值。 */
export type HandledAction = (typeof HANDLED_ACTIONS)[number];

/** 网络质量等级 0~6（§3.4）。0 是 unknown，也是越界值的兜底。 */
export const QUALITY_UNKNOWN = 0;
/** QUALITY_DISCONNECTED 是 level 的上界。 */
export const QUALITY_DISCONNECTED = 6;

/** 振铃超时的默认值与范围（§2.6）。越界钳到边界，不报错。 */
export const DEFAULT_TIMEOUT_SEC = 30;
/** MIN_TIMEOUT_SEC 是振铃超时下界。 */
export const MIN_TIMEOUT_SEC = 5;
/** MAX_TIMEOUT_SEC 是振铃超时上界。 */
export const MAX_TIMEOUT_SEC = 120;
