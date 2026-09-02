import type { FrameFields } from './fieldSpec.js';

/** sys 域：连接、鉴权、心跳、错误。见 RTC_PROTOCOL.md §1 与 §7。 */

/** EMPTY_FIELDS 用于 data 恒为 {} 的帧：sys.ping / sys.pong / 各种纯 ack。 */
export const EMPTY_FIELDS = {} as const satisfies FrameFields;

/**
 * HELLO_FIELDS：WS 打开后必须在 5 秒内发出的第一帧（§1.2）。
 *
 * token 走首帧而不是 URL 查询串：查询串会进网关日志、Referer 与浏览器历史。
 */
export const HELLO_FIELDS = {
  protocolVersion: { kind: 'int', wire: 'protocol_version', default: 1 },
  token: { kind: 'string', wire: 'token' },
  deviceId: { kind: 'string', wire: 'device_id' },
  /** 重连恢复用；首次连接为 ''。 */
  sessionId: { kind: 'string', wire: 'session_id' },
  /** 仅用于日志与灰度，**禁止参与逻辑**。 */
  sdk: { kind: 'string', wire: 'sdk' },
} as const satisfies FrameFields;

/** LIMITS_FIELDS：服务端下发的限额，让客户端能本地预校验（§2.6）。 */
export const LIMITS_FIELDS = {
  maxFrameBytes: { kind: 'int', wire: 'max_frame_bytes' },
  maxCallees: { kind: 'int', wire: 'max_callees' },
  maxRoomParticipants: { kind: 'int', wire: 'max_room_participants' },
  maxUserDataBytes: { kind: 'int', wire: 'max_user_data_bytes' },
  ringTimeoutSecDefault: { kind: 'int', wire: 'ring_timeout_sec_default' },
} as const satisfies FrameFields;

/** HELLO_OK_FIELDS：鉴权成功的应答。 */
export const HELLO_OK_FIELDS = {
  uid: { kind: 'string', wire: 'uid' },
  deviceId: { kind: 'string', wire: 'device_id' },
  sessionId: { kind: 'string', wire: 'session_id' },
  /** 供客户端算时钟偏移，**只做展示**。 */
  serverTimeMs: { kind: 'int', wire: 'server_time_ms' },
  resumed: { kind: 'bool', wire: 'resumed' },
  pingIntervalSec: { kind: 'int', wire: 'ping_interval_sec' },
  limits: { kind: 'object', wire: 'limits', fields: LIMITS_FIELDS },
} as const satisfies FrameFields;

/** ERROR_FIELDS：sys.error 的 data（§7）。 */
export const ERROR_FIELDS = {
  code: { kind: 'int', wire: 'code' },
  name: { kind: 'string', wire: 'name' },
  /** 英文固定短语，给开发者看；**禁止直接显示给用户**。 */
  msg: { kind: 'string', wire: 'msg' },
  forType: { kind: 'string', wire: 'for_type' },
  retryable: { kind: 'bool', wire: 'retryable' },
} as const satisfies FrameFields;
