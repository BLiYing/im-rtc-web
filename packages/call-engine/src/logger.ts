/**
 * 日志：**engine / uikit / demo 的唯一日志入口**（CONVENTIONS §6）。
 *
 * 机制与取舍见 `im-rtc-server/docs/mechanism/LOGGING.md`——那份文档是四仓统一的。
 * 三条要点：
 * - **三条管道分开**：诊断日志（这里）/ 业务事件（engine 回调）/ 质量指标（onNetworkQuality）。
 * - **级别按「谁该被叫醒」分**：断线是 `warn` 不是 `error`（那是常态）；
 *   `info` 只记状态跃迁，一次通话个位数条。
 * - **不提供任何兼容桥接**——想打日志只有这一条路。姊妹项目上正是因为有桥接兜底，
 *   54 处违规才能长期无人察觉。`scripts/check-logging.sh` 会拦住直接用 console 的写法。
 */

/** LogLevel 是日志级别。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** LogFields 是结构化字段。 */
export type LogFields = Readonly<Record<string, unknown>>;

/** LogSink 接收一条日志。宿主可以替换它把日志接进自己的体系。 */
export type LogSink = (level: LogLevel, message: string, fields: LogFields) => void;

/**
 * LogField 是必带字段的名字，**与服务端 internal/observability 的常量一一对应**。
 *
 * 别写字符串字面量：`room_id` / `roomId` / `room` 三种写法同时出现在一份日志里，
 * 就没法按字段检索了。
 */
export const LogField = {
  requestId: 'request_id',
  sessionId: 'session_id',
  roomId: 'room_id',
  callId: 'call_id',
  uid: 'uid',
  deviceId: 'device_id',
  trackId: 'track_id',
  code: 'code',
} as const;

/** DiagnosticEntry 是环形缓冲里的一条。 */
export interface DiagnosticEntry {
  readonly atMs: number;
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: LogFields;
}

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * DIAGNOSTIC_CAPACITY 是诊断环形缓冲的容量。
 *
 * RTC 的报障几乎都是「刚才那通电话很卡」——没有那一段的日志就无从查起。
 * 512 条够覆盖一次通话的全部状态跃迁与告警，又不至于把内存吃掉。
 */
const DIAGNOSTIC_CAPACITY = 512;

/* eslint-disable no-console */
const defaultSink: LogSink = (level, message, fields) => {
  // 这里是**唯一**允许碰 console 的地方；业务代码一律走 logger。
  const payload = { level, message, ...fields };
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
};
/* eslint-enable no-console */

let sink: LogSink = defaultSink;
let minLevel: LogLevel = 'info';
let ring: DiagnosticEntry[] = [];
let nowFn: () => number = Date.now;

/** setLogSink 替换日志出口。传 null 恢复默认。 */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? defaultSink;
}

/** setLogLevel 设置最低输出级别。生产建议 'info'。 */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

/** setLogClock 注入时钟，仅供测试。 */
export function setLogClock(next: (() => number) | null): void {
  nowFn = next ?? Date.now;
}

/**
 * exportDiagnostics 导出最近的日志，供宿主做「报告问题」按钮。
 *
 * **不受 setLogLevel 影响**：环形缓冲永远记 `info` 及以上，
 * 否则用户报障时正好没开 debug，等于什么都没有。
 */
export function exportDiagnostics(): DiagnosticEntry[] {
  return [...ring];
}

/** clearDiagnostics 清空环形缓冲（通话结束或宿主登出时）。 */
export function clearDiagnostics(): void {
  ring = [];
}

function emit(level: LogLevel, message: string, fields: LogFields): void {
  // 环形缓冲先记：它的门槛是 info，与 setLogLevel 无关。
  if (LEVEL_ORDER[level] >= LEVEL_ORDER.info) {
    ring.push({ atMs: nowFn(), level, message, fields });
    if (ring.length > DIAGNOSTIC_CAPACITY) ring.shift();
  }
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  sink(level, message, fields);
}

/** logger 是日志的公开入口。 */
export const logger = {
  debug: (message: string, fields: LogFields = {}): void => emit('debug', message, fields),
  info: (message: string, fields: LogFields = {}): void => emit('info', message, fields),
  warn: (message: string, fields: LogFields = {}): void => emit('warn', message, fields),
  error: (message: string, fields: LogFields = {}): void => emit('error', message, fields),
};

export { redact, redactCandidate, redactSdp } from './redact.js';
