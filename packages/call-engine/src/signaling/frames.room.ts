import {
  LAYERS,
  PC_ROLES,
  REASONS,
  ROOM_KINDS,
  TRACK_KINDS,
  TRACK_SOURCES,
} from './enums.js';
import type { FrameFields } from './fieldSpec.js';

/**
 * room 域：房间与媒体。见 RTC_PROTOCOL.md §3。
 * Room 层是媒体的全部——1v1、群通话、会议都用同一套帧。
 */

/** PARTICIPANT_FIELDS：房间成员快照。 */
export const PARTICIPANT_FIELDS = {
  participantId: { kind: 'string', wire: 'participant_id' },
  uid: { kind: 'string', wire: 'uid' },
  deviceId: { kind: 'string', wire: 'device_id' },
  joinedAtMs: { kind: 'int', wire: 'joined_at_ms' },
} as const satisfies FrameFields;

/** TRACK_FIELDS：一条已发布 Track 的快照。 */
export const TRACK_FIELDS = {
  trackId: { kind: 'string', wire: 'track_id' },
  participantId: { kind: 'string', wire: 'participant_id' },
  uid: { kind: 'string', wire: 'uid' },
  kind: { kind: 'enum', wire: 'kind', values: TRACK_KINDS, fallback: 'audio' },
  source: { kind: 'enum', wire: 'source', values: TRACK_SOURCES, fallback: 'microphone' },
  codec: { kind: 'string', wire: 'codec' },
  /** 空数组 = 单层。**不能是 null**。 */
  simulcastLayers: { kind: 'enumArray', wire: 'simulcast_layers', values: LAYERS, fallback: 'l' },
  muted: { kind: 'bool', wire: 'muted' },
} as const satisfies FrameFields;

/**
 * JOIN_FIELDS：进房请求。
 *
 * **注意 auto_subscribe / publish_audio 默认是 true**：直接用零值对象发这一帧，
 * 线路上会变成 false，人进了房却收不到任何流。发送侧一律用 newJoinData()。
 */
export const JOIN_FIELDS = {
  roomId: { kind: 'string', wire: 'room_id' },
  roomToken: { kind: 'string', wire: 'room_token' },
  autoSubscribe: { kind: 'bool', wire: 'auto_subscribe', default: true },
  publishAudio: { kind: 'bool', wire: 'publish_audio', default: true },
  publishVideo: { kind: 'bool', wire: 'publish_video', default: false },
} as const satisfies FrameFields;

/** JOIN_OK_FIELDS：带回整个房间的快照，客户端据此一次性把九宫格搭起来。 */
export const JOIN_OK_FIELDS = {
  roomId: { kind: 'string', wire: 'room_id' },
  roomKind: { kind: 'enum', wire: 'room_kind', values: ROOM_KINDS, fallback: 'call_group' },
  participantId: { kind: 'string', wire: 'participant_id' },
  maxParticipants: { kind: 'int', wire: 'max_participants' },
  joinedAtMs: { kind: 'int', wire: 'joined_at_ms' },
  participants: { kind: 'objectArray', wire: 'participants', fields: PARTICIPANT_FIELDS },
  tracks: { kind: 'objectArray', wire: 'tracks', fields: TRACK_FIELDS },
} as const satisfies FrameFields;

/** LEAVE_FIELDS：离房请求。 */
export const LEAVE_FIELDS = {
  roomId: { kind: 'string', wire: 'room_id' },
} as const satisfies FrameFields;

/**
 * PUBLISH_FIELDS：发布请求。
 *
 * cid 是**客户端**生成的本地 track 标识，必须出现在随后 pub offer 的 msid 里；
 * 服务端靠它把 SDP 的 m-line 认回 track_id。
 */
export const PUBLISH_FIELDS = {
  cid: { kind: 'string', wire: 'cid' },
  kind: { kind: 'enum', wire: 'kind', values: TRACK_KINDS, fallback: 'audio' },
  source: { kind: 'enum', wire: 'source', values: TRACK_SOURCES, fallback: 'microphone' },
  simulcast: { kind: 'bool', wire: 'simulcast' },
  width: { kind: 'int', wire: 'width' },
  height: { kind: 'int', wire: 'height' },
  maxBitrateKbps: { kind: 'int', wire: 'max_bitrate_kbps' },
} as const satisfies FrameFields;

/** PUBLISH_OK_FIELDS：回带 track_id 与原样回显的 cid 供配对。 */
export const PUBLISH_OK_FIELDS = {
  trackId: { kind: 'string', wire: 'track_id' },
  cid: { kind: 'string', wire: 'cid' },
} as const satisfies FrameFields;

/** TRACK_ID_FIELDS：只带 track_id 的帧（unpublish / unsubscribe）。 */
export const TRACK_ID_FIELDS = {
  trackId: { kind: 'string', wire: 'track_id' },
} as const satisfies FrameFields;

/** MUTE_FIELDS：开关麦克风/摄像头。**这不是 unpublish**，Track 与协商都保留。 */
export const MUTE_FIELDS = {
  trackId: { kind: 'string', wire: 'track_id' },
  muted: { kind: 'bool', wire: 'muted' },
} as const satisfies FrameFields;

/** LAYER_FIELDS：订阅与换层。max_layer 是**上界不是命令**。 */
export const LAYER_FIELDS = {
  trackId: { kind: 'string', wire: 'track_id' },
  maxLayer: { kind: 'enum', wire: 'max_layer', values: LAYERS, fallback: 'l', default: 'm' },
} as const satisfies FrameFields;

/** SDP_FIELDS：room.offer 与 room.answer 共用。 */
export const SDP_FIELDS = {
  pc: { kind: 'enum', wire: 'pc', values: PC_ROLES, fallback: 'pub' },
  sdp: { kind: 'string', wire: 'sdp' },
} as const satisfies FrameFields;

/** ICE_FIELDS：trickle ICE 候选。candidate 为 '' 表示收集结束，接收方必须容忍。 */
export const ICE_FIELDS = {
  pc: { kind: 'enum', wire: 'pc', values: PC_ROLES, fallback: 'pub' },
  candidate: { kind: 'string', wire: 'candidate' },
  sdpMid: { kind: 'string', wire: 'sdp_mid' },
  sdpMLineIndex: { kind: 'int', wire: 'sdp_mline_index' },
} as const satisfies FrameFields;

/** PARTICIPANT_JOINED_FIELDS：有人进房。 */
export const PARTICIPANT_JOINED_FIELDS = {
  roomId: { kind: 'string', wire: 'room_id' },
  participantId: { kind: 'string', wire: 'participant_id' },
  uid: { kind: 'string', wire: 'uid' },
  deviceId: { kind: 'string', wire: 'device_id' },
  joinedAtMs: { kind: 'int', wire: 'joined_at_ms' },
} as const satisfies FrameFields;

/** PARTICIPANT_LEFT_FIELDS：有人离房。reason 取 §6 的子集。 */
export const PARTICIPANT_LEFT_FIELDS = {
  roomId: { kind: 'string', wire: 'room_id' },
  participantId: { kind: 'string', wire: 'participant_id' },
  uid: { kind: 'string', wire: 'uid' },
  deviceId: { kind: 'string', wire: 'device_id' },
  reason: { kind: 'enum', wire: 'reason', values: REASONS, fallback: 'error' },
  durationSec: { kind: 'int', wire: 'duration_sec' },
} as const satisfies FrameFields;

/** TRACK_PUBLISHED_FIELDS：有人发布了 Track。 */
export const TRACK_PUBLISHED_FIELDS = {
  roomId: { kind: 'string', wire: 'room_id' },
  ...TRACK_FIELDS,
} as const satisfies FrameFields;

/** TRACK_UNPUBLISHED_FIELDS：有人销毁了 Track。 */
export const TRACK_UNPUBLISHED_FIELDS = {
  roomId: { kind: 'string', wire: 'room_id' },
  trackId: { kind: 'string', wire: 'track_id' },
  participantId: { kind: 'string', wire: 'participant_id' },
  uid: { kind: 'string', wire: 'uid' },
} as const satisfies FrameFields;

/** TRACK_MUTED_FIELDS：对应 onUserAudioAvailable / onUserVideoAvailable。 */
export const TRACK_MUTED_FIELDS = {
  roomId: { kind: 'string', wire: 'room_id' },
  trackId: { kind: 'string', wire: 'track_id' },
  participantId: { kind: 'string', wire: 'participant_id' },
  uid: { kind: 'string', wire: 'uid' },
  kind: { kind: 'enum', wire: 'kind', values: TRACK_KINDS, fallback: 'audio' },
  muted: { kind: 'bool', wire: 'muted' },
} as const satisfies FrameFields;

/** SPEAKER_FIELDS：一个正在说话的人。volume 0~100，**整数**。 */
export const SPEAKER_FIELDS = {
  participantId: { kind: 'string', wire: 'participant_id' },
  uid: { kind: 'string', wire: 'uid' },
  volume: { kind: 'int', wire: 'volume', min: 0, max: 100 },
} as const satisfies FrameFields;

/** ACTIVE_SPEAKERS_FIELDS：服务端节流 300ms，客户端**不得**依赖更高频率。 */
export const ACTIVE_SPEAKERS_FIELDS = {
  roomId: { kind: 'string', wire: 'room_id' },
  speakers: { kind: 'objectArray', wire: 'speakers', fields: SPEAKER_FIELDS },
} as const satisfies FrameFields;

/** QUALITY_ENTRY_FIELDS：一个人的网络质量，level 0~6。 */
export const QUALITY_ENTRY_FIELDS = {
  participantId: { kind: 'string', wire: 'participant_id' },
  uid: { kind: 'string', wire: 'uid' },
  // 越界折成 0 = unknown，**不是钳到 6**——把未知说成「已断开」会误导 UI。
  level: { kind: 'int', wire: 'level', min: 0, max: 6, outOfRange: 0 },
} as const satisfies FrameFields;

/** QUALITY_FIELDS：服务端节流 2s。 */
export const QUALITY_FIELDS = {
  roomId: { kind: 'string', wire: 'room_id' },
  entries: { kind: 'objectArray', wire: 'entries', fields: QUALITY_ENTRY_FIELDS },
} as const satisfies FrameFields;

/** ROOM_CLOSED_FIELDS：房间结束。 */
export const ROOM_CLOSED_FIELDS = {
  roomId: { kind: 'string', wire: 'room_id' },
  reason: { kind: 'enum', wire: 'reason', values: REASONS, fallback: 'error' },
  durationSec: { kind: 'int', wire: 'duration_sec' },
} as const satisfies FrameFields;
