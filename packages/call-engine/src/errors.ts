/**
 * 错误码：**四仓共用同一份定义**，单一真相源是
 * `im-rtc-server/docs/conformance/error_codes.json`（由 RTC_PROTOCOL.md §7 定稿）。
 *
 * 本文件的表由那份 JSON 手工同步而来，`test/conformance.test.ts` 逐条断言两者相等——
 * 加了码却忘了同步，测试立刻挂。
 *
 * 两条硬约束：
 * - `msg` 是**英文固定短语**，四端必须完全一致；它给开发者看，
 *   **禁止直接显示给用户**，UI 文案由各端按 code 查自己的本地化表。
 * - 2xxx 段是**客户端本地错误码**，永远不会出现在线路上。
 */

/** ErrorCode 是稳定的错误码。**只增不改不删**。 */
export const ErrorCode = {
  /** 信封字段缺失/类型错/data 为 null */
  badEnvelope: 1001,
  /** 未知 type */
  unknownType: 1002,
  /** 会议层留位帧，v1 未实现 */
  notImplemented: 1003,
  /** data 字段非法：超长、枚举越界、数组含自己 */
  badParams: 1004,
  /** 单帧超过 64 KiB */
  frameTooLarge: 1005,
  /** sys.hello.protocol_version 不受支持 */
  protocolVersionUnsupported: 1006,
  /** 上行频率超限 */
  rateLimited: 1007,
  /** token 签名/受众/绑定关系错 */
  tokenInvalid: 1101,
  /** token 过期，换新的重试 */
  tokenExpired: 1102,
  /** 未发 sys.hello 就发别的帧 */
  notAuthenticated: 1103,
  /** 同 uid 同 device_id 在别处登录 */
  kickedOut: 1104,
  /** session_id 无效或超出 30s 恢复窗口 */
  sessionNotResumable: 1105,
  /** 房间不存在或已关闭 */
  roomNotFound: 1201,
  /** 超出 max_participants */
  roomFull: 1202,
  /** 未 join 就发房间帧 */
  notInRoom: 1203,
  /** 重复 join 同一房间 */
  alreadyInRoom: 1204,
  /** 房间已被解散 */
  roomClosed: 1205,
  /** 无该操作权限 */
  permissionDenied: 1206,
  /** 目标 participant 不在房 */
  participantNotFound: 1207,
  /** 订阅/退订不存在的 track */
  trackNotFound: 1301,
  /** 同 source 重复发布或房间策略禁止 */
  publishDenied: 1302,
  /** 订阅自己的 track 或无订阅权限 */
  subscribeDenied: 1303,
  /** SDP 解析失败/超长/cid 认不回来/在非 offerer 侧发 offer */
  sdpInvalid: 1304,
  /** pc 对应的 PeerConnection 不存在 */
  pcNotFound: 1305,
  /** max_layer 取值非法 */
  layerUnavailable: 1306,
  /** SDP 里没有共同编码 */
  codecUnsupported: 1307,
  /** call_id 不存在 */
  callNotFound: 1401,
  /** 通话已结束，客户端必须静默吞掉 */
  callEnded: 1402,
  /** 保留：v1 走 call.ended{offline} 而非报错 */
  calleeOffline: 1403,
  /** 保留：v1 走 call.ended{busy} 而非报错 */
  calleeBusy: 1404,
  /** 在错误状态下 accept/reject/cancel/hangup */
  invalidCallState: 1405,
  /** callee_ids 超上限 */
  tooManyCallees: 1406,
  /** 非主叫发 call.cancel / call.invite_more */
  notCallOwner: 1407,
  /** 自己已在别的通话中 */
  alreadyInCall: 1408,
  /** 内部错误兜底 */
  internal: 1501,
  /** 无可用 SFU 节点 */
  sfuUnavailable: 1502,
  /** 服务端正在优雅关闭 */
  shuttingDown: 1503,
  /** 持久化失败 */
  storeError: 1504,
  /** 用户拒绝麦克风/摄像头权限 */
  devicePermissionDenied: 2001,
  /** 没有可用的采集设备 */
  deviceNotFound: 2002,
  /** 信令连不上、DNS/TLS 失败 */
  networkUnreachable: 2003,
  /** 请求 10 秒无应答 */
  signalingTimeout: 2004,
  /** 宿主在错误状态下调 Engine 方法 */
  invalidState: 2005,
  /** PeerConnection 协商失败 / ICE failed */
  mediaNegotiationFailed: 2006,
  /** 未 login 就调业务方法 */
  notLoggedIn: 2007,
} as const;

/** ErrorCodeName 是错误码的键名联合。 */
export type ErrorCodeName = keyof typeof ErrorCode;

/** ErrorCodeValue 是错误码的数值联合。 */
export type ErrorCodeValue = (typeof ErrorCode)[ErrorCodeName];

/** ErrorDefinition 是一个错误码的全部契约面。 */
export interface ErrorDefinition {
  readonly code: number;
  /** 稳定机读名，与 code 一一对应。 */
  readonly name: string;
  /** 英文固定短语，四端必须完全一致。 */
  readonly msg: string;
  /** true = 原样重试可能成功。 */
  readonly retryable: boolean;
  /** true = 客户端本地错误码（2xxx），永不上线路。 */
  readonly local: boolean;
}

/** ERROR_DEFINITIONS 的顺序与 error_codes.json 一致，便于对读。 */
export const ERROR_DEFINITIONS: readonly ErrorDefinition[] = [
  { code: 1001, name: 'bad_envelope', msg: 'malformed envelope', retryable: false, local: false },
  { code: 1002, name: 'unknown_type', msg: 'unknown frame type', retryable: false, local: false },
  { code: 1003, name: 'not_implemented', msg: 'frame not implemented', retryable: false, local: false },
  { code: 1004, name: 'bad_params', msg: 'invalid frame parameters', retryable: false, local: false },
  { code: 1005, name: 'frame_too_large', msg: 'frame too large', retryable: false, local: false },
  { code: 1006, name: 'protocol_version_unsupported', msg: 'protocol version unsupported', retryable: false, local: false },
  { code: 1007, name: 'rate_limited', msg: 'rate limited', retryable: true, local: false },
  { code: 1101, name: 'token_invalid', msg: 'token invalid', retryable: false, local: false },
  { code: 1102, name: 'token_expired', msg: 'token expired', retryable: true, local: false },
  { code: 1103, name: 'not_authenticated', msg: 'not authenticated', retryable: false, local: false },
  { code: 1104, name: 'kicked_out', msg: 'kicked out', retryable: false, local: false },
  { code: 1105, name: 'session_not_resumable', msg: 'session not resumable', retryable: false, local: false },
  { code: 1201, name: 'room_not_found', msg: 'room not found', retryable: false, local: false },
  { code: 1202, name: 'room_full', msg: 'room is full', retryable: false, local: false },
  { code: 1203, name: 'not_in_room', msg: 'not in room', retryable: false, local: false },
  { code: 1204, name: 'already_in_room', msg: 'already in room', retryable: false, local: false },
  { code: 1205, name: 'room_closed', msg: 'room closed', retryable: false, local: false },
  { code: 1206, name: 'permission_denied', msg: 'permission denied', retryable: false, local: false },
  { code: 1207, name: 'participant_not_found', msg: 'participant not found', retryable: false, local: false },
  { code: 1301, name: 'track_not_found', msg: 'track not found', retryable: false, local: false },
  { code: 1302, name: 'publish_denied', msg: 'publish denied', retryable: false, local: false },
  { code: 1303, name: 'subscribe_denied', msg: 'subscribe denied', retryable: false, local: false },
  { code: 1304, name: 'sdp_invalid', msg: 'sdp invalid', retryable: false, local: false },
  { code: 1305, name: 'pc_not_found', msg: 'peer connection not found', retryable: false, local: false },
  { code: 1306, name: 'layer_unavailable', msg: 'layer unavailable', retryable: false, local: false },
  { code: 1307, name: 'codec_unsupported', msg: 'codec unsupported', retryable: false, local: false },
  { code: 1401, name: 'call_not_found', msg: 'call not found', retryable: false, local: false },
  { code: 1402, name: 'call_ended', msg: 'call already ended', retryable: false, local: false },
  { code: 1403, name: 'callee_offline', msg: 'callee offline', retryable: false, local: false },
  { code: 1404, name: 'callee_busy', msg: 'callee busy', retryable: false, local: false },
  { code: 1405, name: 'invalid_call_state', msg: 'invalid call state', retryable: false, local: false },
  { code: 1406, name: 'too_many_callees', msg: 'too many callees', retryable: false, local: false },
  { code: 1407, name: 'not_call_owner', msg: 'not call owner', retryable: false, local: false },
  { code: 1408, name: 'already_in_call', msg: 'already in call', retryable: false, local: false },
  { code: 1501, name: 'internal', msg: 'internal error', retryable: true, local: false },
  { code: 1502, name: 'sfu_unavailable', msg: 'sfu unavailable', retryable: true, local: false },
  { code: 1503, name: 'shutting_down', msg: 'server shutting down', retryable: true, local: false },
  { code: 1504, name: 'store_error', msg: 'store error', retryable: true, local: false },
  { code: 2001, name: 'device_permission_denied', msg: 'device permission denied', retryable: false, local: true },
  { code: 2002, name: 'device_not_found', msg: 'device not found', retryable: false, local: true },
  { code: 2003, name: 'network_unreachable', msg: 'network unreachable', retryable: true, local: true },
  { code: 2004, name: 'signaling_timeout', msg: 'signaling timeout', retryable: true, local: true },
  { code: 2005, name: 'invalid_state', msg: 'invalid state', retryable: false, local: true },
  { code: 2006, name: 'media_negotiation_failed', msg: 'media negotiation failed', retryable: false, local: true },
  { code: 2007, name: 'not_logged_in', msg: 'not logged in', retryable: false, local: true },
];

const byCode = new Map<number, ErrorDefinition>(ERROR_DEFINITIONS.map((d) => [d.code, d]));

/** lookupError 按 code 查定义；未知码返回 undefined。 */
export function lookupError(code: number): ErrorDefinition | undefined {
  return byCode.get(code);
}

/** errorName 返回错误码的机读名；未知码返回 'unknown'。 */
export function errorName(code: number): string {
  return byCode.get(code)?.name ?? 'unknown';
}

/** isRetryable 报告这个码是否值得原样重试；未知码保守地按不可重试处理。 */
export function isRetryable(code: number): boolean {
  return byCode.get(code)?.retryable ?? false;
}

/** isLocalError 报告这个码是不是客户端本地码（永不上线路）。 */
export function isLocalError(code: number): boolean {
  return byCode.get(code)?.local ?? false;
}

/**
 * RtcError 是 engine 对外抛的统一错误。
 *
 * `cause` 只用于日志，**不参与任何面向用户的展示**——这是「不把内部错误
 * 透传给用户」那条规矩在 TS 侧的落点。
 */
export class RtcError extends Error {
  readonly code: number;
  readonly name_: string;
  readonly retryable: boolean;
  /** 出错的请求 type；无对应请求时为 ''。 */
  readonly forType: string;

  constructor(code: number, options: { forType?: string; cause?: unknown } = {}) {
    const def = byCode.get(code) ?? byCode.get(ErrorCode.internal);
    // def 一定存在：internal 是表里的固定项，上一行的兜底保证了这一点。
    const resolved = def as ErrorDefinition;
    super(`${resolved.name}(${resolved.code}): ${resolved.msg}`, { cause: options.cause });
    this.name = 'RtcError';
    this.code = resolved.code;
    this.name_ = resolved.name;
    this.retryable = resolved.retryable;
    this.forType = options.forType ?? '';
  }

  /** wireShape 返回可以放进 sys.error 的 data —— 注意**不含** cause。 */
  wireShape(): { code: number; name: string; msg: string; for_type: string; retryable: boolean } {
    const def = byCode.get(this.code) ?? byCode.get(ErrorCode.internal);
    const resolved = def as ErrorDefinition;
    return {
      code: resolved.code,
      name: resolved.name,
      msg: resolved.msg,
      for_type: this.forType,
      retryable: resolved.retryable,
    };
  }
}

/** isRtcError 是 RtcError 的类型守卫。 */
export function isRtcError(err: unknown): err is RtcError {
  return err instanceof RtcError;
}
