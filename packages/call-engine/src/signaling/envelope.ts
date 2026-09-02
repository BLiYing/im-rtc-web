import { ErrorCode, RtcError } from '../errors.js';
import { checkDiscipline } from './discipline.js';

/**
 * 信封：**每一帧都是一个 JSON 对象，四个字段，一个不多一个不少**
 * （RTC_PROTOCOL.md §2.1）。
 */

/** MAX_FRAME_BYTES 是单帧上限（§2.6）。超限对应 WS 关闭码 4400。 */
export const MAX_FRAME_BYTES = 64 * 1024;

/** OK_SUFFIX 是成功应答的唯一后缀（§2.2）。 */
export const OK_SUFFIX = '.ok';

/** okType 返回某个请求帧对应的成功应答类型。 */
export function okType(requestType: string): string {
  return requestType + OK_SUFFIX;
}

/** Envelope 是解析后的信封。字段名在 TS 侧用 camelCase，线路上是 snake_case。 */
export interface Envelope {
  readonly type: string;
  /** 服务端主动推送的事件恒为 ''（§2.2）。 */
  readonly reqId: string;
  /** 发送方的 Unix 毫秒时间戳。**只用于日志，禁止参与逻辑判断**（时钟偏移）。 */
  readonly ts: number;
  readonly data: Readonly<Record<string, unknown>>;
}

const REQUIRED_KEYS = ['type', 'req_id', 'ts', 'data'] as const;

/**
 * decodeEnvelope 把一帧原始文本解成 Envelope，并施加 §2.4 的编码硬规则。
 *
 * 它**不做**帧级解析——那是 decodeFrame 的事。分成两步是因为路由阶段
 * 只需要 type 与 req_id，没必要为一个马上要丢掉的帧去解 data。
 */
export function decodeEnvelope(raw: string): Envelope {
  if (byteLength(raw) > MAX_FRAME_BYTES) {
    throw new RtcError(ErrorCode.frameTooLarge, {
      cause: new Error(`帧 ${byteLength(raw)} 字节 > 上限 ${MAX_FRAME_BYTES}`),
    });
  }

  const parsed = parseObject(raw);
  for (const key of REQUIRED_KEYS) {
    if (!Object.hasOwn(parsed, key)) {
      throw badEnvelope(`缺少必填字段 "${key}"`);
    }
  }

  const type = parsed['type'];
  if (typeof type !== 'string' || type === '') {
    throw badEnvelope('字段 type 必须是非空字符串');
  }
  const reqId = parsed['req_id'];
  if (typeof reqId !== 'string') {
    // req_id 允许是 ''（事件就是 ''），但不允许缺失或非字符串。
    throw badEnvelope('字段 req_id 必须是字符串');
  }
  const ts = parsed['ts'];
  if (typeof ts !== 'number' || !Number.isInteger(ts)) {
    throw badEnvelope('字段 ts 必须是整数');
  }
  const data = parsed['data'];
  if (data === null) {
    throw badEnvelope('字段 data 不能是 null，无内容时用 {}');
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw badEnvelope('字段 data 必须是对象，无内容时用 {}');
  }

  checkDiscipline(data);
  return { type, reqId, ts, data: data as Readonly<Record<string, unknown>> };
}

/** encodeEnvelope 序列化一帧。data 省略时写成 {}。 */
export function encodeEnvelope(
  type: string,
  reqId: string,
  data: Readonly<Record<string, unknown>> = {},
  ts: number = Date.now(),
): string {
  if (type === '') throw badEnvelope('type 不能为空');
  const raw = JSON.stringify({ type, req_id: reqId, ts, data });
  if (byteLength(raw) > MAX_FRAME_BYTES) {
    throw new RtcError(ErrorCode.frameTooLarge, {
      cause: new Error(`${type} 编码后 ${byteLength(raw)} 字节 > 上限 ${MAX_FRAME_BYTES}`),
    });
  }
  return raw;
}

/** isEvent 报告这一帧是不是服务端主动推送的事件。 */
export function isEvent(envelope: Envelope): boolean {
  return envelope.reqId === '';
}

function parseObject(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new RtcError(ErrorCode.badEnvelope, { cause });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw badEnvelope('一帧必须是一个 JSON 对象');
  }
  // parsed 已确认是非数组的普通对象，这个断言是安全的。
  return parsed as Record<string, unknown>;
}

function badEnvelope(reason: string): RtcError {
  return new RtcError(ErrorCode.badEnvelope, { cause: new Error(reason) });
}

/** byteLength 按 UTF-8 计算字节数——协议的上限是**字节**不是字符。 */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
