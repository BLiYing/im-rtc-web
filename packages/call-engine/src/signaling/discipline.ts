import { ErrorCode, RtcError } from '../errors.js';

/**
 * RTC_PROTOCOL.md §2.4「七条编码硬规则」里能**脱离帧定义**判定的那几条。
 *
 * 它们是「三端都能实现」这句话的落点：不放浮点、不放 null、数组同构、嵌套不超过两层，
 * 于是 C++ 不需要 optional<optional<T>>、TS 不需要区分 undefined 与 null、
 * Swift 不需要 Optional<Optional>。
 *
 * 剩下两条（字段类型恒定、枚举封闭带兜底）没法脱离帧定义判，由 fieldSpec.ts 负责。
 */

/** data 本身算第 1 层，再嵌一层算第 2 层，第 3 层非法。数组不增加深度。 */
const MAX_OBJECT_DEPTH = 2;

/** 2^53-1：超出这个范围 JS 会**静默**丢精度，那种 bug 在四端联调里基本定位不了。 */
const MAX_SAFE_PROTOCOL_INT = Number.MAX_SAFE_INTEGER;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * checkDiscipline 检查一个已解析的 data 是否满足编码硬规则。
 * 违规抛 RtcError（bad_envelope 或 bad_params）。
 */
export function checkDiscipline(data: unknown): void {
  walk(data as JsonValue, 1, 'data');
}

function walk(value: JsonValue, depth: number, path: string): void {
  if (value === null) {
    // §2.4 规则 2：协议里任何位置都不许出现 null。可选字段的表达方式是**省略**。
    throw new RtcError(ErrorCode.badEnvelope, {
      cause: new Error(`${path}: 出现 null；可选字段请省略，不要写 null`),
    });
  }
  if (typeof value === 'number') {
    checkNumber(value, path);
    return;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return;

  if (Array.isArray(value)) {
    walkArray(value, depth, path);
    return;
  }
  walkObject(value, depth, path);
}

function walkObject(value: { [key: string]: JsonValue }, depth: number, path: string): void {
  if (depth > MAX_OBJECT_DEPTH) {
    throw new RtcError(ErrorCode.badParams, {
      cause: new Error(
        `${path}: 对象嵌套 ${depth} 层 > 上限 ${MAX_OBJECT_DEPTH}；` +
          '要塞任意结构请用 user_data（opaque 字符串）',
      ),
    });
  }
  for (const [key, child] of Object.entries(value)) {
    walk(child, depth + 1, `${path}.${key}`);
  }
}

/**
 * walkArray 除了递归检查元素，还要确认数组是**同构**的（§2.4 规则 4）。
 * 异构数组在 TS/Swift 里勉强能表达，在 C++ 里就得上 variant——所以协议层直接禁掉。
 */
function walkArray(value: JsonValue[], depth: number, path: string): void {
  let firstKind: string | undefined;
  for (let i = 0; i < value.length; i += 1) {
    // noUncheckedIndexedAccess 下这是 JsonValue | undefined；数组内不会有洞，
    // 但类型系统不知道，所以显式取一次。
    const element = value[i] as JsonValue;
    const kind = kindOf(element);
    if (i === 0) {
      firstKind = kind;
    } else if (kind !== firstKind) {
      throw new RtcError(ErrorCode.badParams, {
        cause: new Error(
          `${path}: 数组必须同构，第 0 个是 ${String(firstKind)}、第 ${i} 个是 ${kind}；` +
            '要成对请用对象数组',
        ),
      });
    }
    walk(element, depth, `${path}[${i}]`);
  }
}

/**
 * checkNumber 落实 §2.4 规则 1（没有浮点数）与规则 7（整数不超过 2^53-1）。
 *
 * 判定按**值**而不是按字面量：`1e3` 是整数 1000，合法；`4.5` 不是，非法。
 * 四端必须用同一套判定，否则一端发得出去、另一端收不下来。
 */
function checkNumber(value: number, path: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new RtcError(ErrorCode.badParams, {
      cause: new Error(
        `${path}: 协议里没有浮点数，得到 ${value}；音量/质量/时长/码率一律用整数`,
      ),
    });
  }
  if (Math.abs(value) > MAX_SAFE_PROTOCOL_INT) {
    throw new RtcError(ErrorCode.badParams, {
      cause: new Error(`${path}: 整数 ${value} 超出 ±(2^53-1)，会静默丢精度`),
    });
  }
}

function kindOf(value: JsonValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
