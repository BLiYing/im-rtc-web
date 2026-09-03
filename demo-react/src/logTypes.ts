/** IMLogEntryLike 是上报给服务端的一条日志，字段名与服务端的 devLogEntry 对齐。 */
export interface IMLogEntryLike {
  readonly at_ms: number;
  readonly level: string;
  readonly msg: string;
  readonly fields: Record<string, string>;
}

/** toEntry 把 engine 的日志参数摊成上报格式。值一律转成字符串，便于 grep。 */
export function toEntry(level: string, msg: string, fields: Record<string, unknown>): IMLogEntryLike {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    flat[key] = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  }
  return { at_ms: Date.now(), level, msg, fields: flat };
}
