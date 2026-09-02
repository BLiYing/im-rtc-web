/**
 * 通话结束原因：**一套 reason，三处共用**——`call.ended` 帧、`onCallEnd` 事件、
 * 服务端 webhook。单一真相源是 `im-rtc-server/docs/conformance/reasons.json`
 * （由 RTC_PROTOCOL.md §6 定稿）。
 */

/** CallEndReason 是通话结束原因的封闭集合。 */
export const CallEndReason = {
  /** 已接通成员主动挂断。时长 > 0。 */
  hangup: 'hangup',
  /** 主叫在接通前取消。 */
  cancel: 'cancel',
  /** 被叫主动拒接。 */
  reject: 'reject',
  /** 服务端振铃超时。 */
  noAnswer: 'no_answer',
  /** 被叫已在别的通话中。 */
  busy: 'busy',
  /** 被叫无在线设备。 */
  offline: 'offline',
  /** 本账号另一台设备接听了。 */
  answeredElsewhere: 'answered_elsewhere',
  /** 本账号另一台设备拒绝了。 */
  rejectedElsewhere: 'rejected_elsewhere',
  /** 被主持人或管理 API 移出。 */
  kicked: 'kicked',
  /** 房间被强制解散。 */
  roomClosed: 'room_closed',
  /** 掉线超过 30 秒恢复窗口。 */
  network: 'network',
  /** 服务端内部错误兜底，**也是未知值的兜底**。 */
  error: 'error',
} as const;

/** CallEndReasonValue 是 reason 的取值联合。 */
export type CallEndReasonValue = (typeof CallEndReason)[keyof typeof CallEndReason];

const KNOWN_REASONS = new Set<string>(Object.values(CallEndReason));

/**
 * normalizeReason 把陌生的 reason 折成 'error'。
 *
 * 这条兜底是 RTC_PROTOCOL.md §10「新增枚举值不算破坏兼容」成立的前提：
 * 服务端发一个老客户端不认识的 reason 时，老客户端**必须**不崩、不把原始字符串
 * 显示给用户。
 */
export function normalizeReason(value: unknown): CallEndReasonValue {
  return typeof value === 'string' && KNOWN_REASONS.has(value)
    ? (value as CallEndReasonValue)
    : CallEndReason.error;
}

/**
 * GROUP_DOMINANT_PRIORITY 是群通话「全员都没接听时取哪个 reason」的固定优先级
 * （RTC_PROTOCOL.md §4.4 规则 3）。
 *
 * 定成有序表而不是散落的 if，是为了**四端算出同一个值**。
 */
export const GROUP_DOMINANT_PRIORITY: readonly CallEndReasonValue[] = [
  CallEndReason.reject,
  CallEndReason.busy,
  CallEndReason.noAnswer,
  CallEndReason.offline,
];

/**
 * dominantReason 从一组成员裁决里挑出群通话的主导 reason。
 * 没有一个落在优先级表里时返回 no_answer——保守地按「没人接」记。
 */
export function dominantReason(outcomes: readonly string[]): CallEndReasonValue {
  for (const candidate of GROUP_DOMINANT_PRIORITY) {
    if (outcomes.includes(candidate)) return candidate;
  }
  return CallEndReason.noAnswer;
}

/**
 * callDurationSec 按协议算通话时长：未接通恒为 0，接通则向下取整到秒。
 *
 * **正常路径下客户端不该自己算**——一律用 `call.ended` 帧里的 `duration_sec`
 * （时钟偏移）。这个函数只服务一个例外：重连恢复失败时服务端的 ended 帧送不到，
 * engine 要本地合成 `onCallEnd(network)`（RTC_PROTOCOL.md 不变量 I8）。
 */
export function callDurationSec(connectedAtMs: number, endedAtMs: number): number {
  if (connectedAtMs <= 0) return 0;
  return Math.max(0, Math.floor((endedAtMs - connectedAtMs) / 1000));
}
