/**
 * 日志：**engine / uikit / demo 的唯一日志入口**（CONVENTIONS §6）。
 *
 * 不提供任何「兼容桥接」——想打日志只有这一条路。姊妹项目上正是因为有桥接兜底，
 * 违规才能长期无人察觉。
 *
 * 两条纪律：
 * - **媒体回调与统计轮询里禁止日志**（高频路径）；
 * - token 类凭据与完整 SDP **不整条打印**，用 `redact()`。
 */

/** LogLevel 是日志级别。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** LogFields 是结构化字段。必带 callId / roomId / uid（有哪个带哪个）。 */
export type LogFields = Readonly<Record<string, unknown>>;

/** LogSink 接收一条日志。宿主可以替换它把日志接进自己的体系。 */
export type LogSink = (level: LogLevel, message: string, fields: LogFields) => void;

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

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

/** setLogSink 替换日志出口。传 null 恢复默认。 */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? defaultSink;
}

/** setLogLevel 设置最低输出级别。 */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function emit(level: LogLevel, message: string, fields: LogFields): void {
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

/**
 * redact 把凭据折成「前 6 位 + 长度」。
 * token、room_token、完整 SDP 进日志前**必须**过这一道。
 */
export function redact(secret: string | undefined): string {
  if (!secret) return '(empty)';
  return `${secret.slice(0, 6)}…(${secret.length})`;
}
