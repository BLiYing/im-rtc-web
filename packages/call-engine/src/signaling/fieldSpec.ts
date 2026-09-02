import { ErrorCode, RtcError } from '../errors.js';

/**
 * 帧字段的**声明式定义**：一处声明同时产出运行时校验与 TS 类型。
 *
 * 为什么不像服务端那样逐帧写结构体：TS 有条件类型，可以从声明推出类型，
 * 于是「协议表 → 代码」只需要写一遍。两处写会漂，一处写不会。
 *
 * 这套声明负责 RTC_PROTOCOL.md §2.4 里**必须结合帧定义**才能判的两条：
 * 规则 3（字段类型恒定）与规则 6（枚举封闭且带兜底）。
 * 与帧无关的四条在 discipline.ts。
 */

/** FieldSpec 是一个字段的契约。`wire` 是线路上的 snake_case 名。 */
export type FieldSpec =
  | { readonly kind: 'string'; readonly wire: string; readonly default?: string }
  | {
      readonly kind: 'int';
      readonly wire: string;
      readonly default?: number;
      readonly min?: number;
      readonly max?: number;
      /**
       * 越界时的处理方式。协议对不同字段的规定不一样，不能一刀切：
       * - `timeout_sec` 越界**钳到边界**（§2.6）；
       * - 质量 `level` 越界**折成 0 = unknown**（§2.4 规则 6 的兜底表）。
       *
       * 给了 outOfRange 就折成它，没给就钳到边界。
       */
      readonly outOfRange?: number;
    }
  | { readonly kind: 'bool'; readonly wire: string; readonly default?: boolean }
  | {
      readonly kind: 'enum';
      readonly wire: string;
      readonly values: readonly string[];
      /** 收到集合外的值时折成它，**禁止崩溃、禁止透传给 UI**。 */
      readonly fallback: string;
      readonly default?: string;
    }
  | { readonly kind: 'stringArray'; readonly wire: string }
  | {
      readonly kind: 'enumArray';
      readonly wire: string;
      readonly values: readonly string[];
      readonly fallback: string;
    }
  | { readonly kind: 'objectArray'; readonly wire: string; readonly fields: FrameFields }
  | { readonly kind: 'object'; readonly wire: string; readonly fields: FrameFields };

/** FrameFields 把 camelCase 属性名映射到字段契约。 */
export type FrameFields = Readonly<Record<string, FieldSpec>>;

/** FieldType 从字段契约推出 TS 类型。 */
type FieldType<S extends FieldSpec> = S extends { kind: 'string' }
  ? string
  : S extends { kind: 'int' }
    ? number
    : S extends { kind: 'bool' }
      ? boolean
      : S extends { kind: 'enum'; values: readonly (infer V)[] }
        ? V
        : S extends { kind: 'stringArray' }
          ? string[]
          : S extends { kind: 'enumArray'; values: readonly (infer V)[] }
            ? V[]
            : S extends { kind: 'objectArray'; fields: infer F }
              ? F extends FrameFields
                ? FrameData<F>[]
                : never
              : S extends { kind: 'object'; fields: infer F }
                ? F extends FrameFields
                  ? FrameData<F>
                  : never
                : never;

/** FrameData 从字段声明推出整帧的 TS 类型。 */
export type FrameData<F extends FrameFields> = { [K in keyof F]: FieldType<F[K]> };

/**
 * decodeFields 把线路上的 data 解成带默认值的帧对象。
 *
 * 「可选字段用省略表达，接收方按默认值填」（§2.4 规则 2）就落在这里：
 * 字段缺席 → 取 spec 的默认值；出现了 → 校验类型、归一化枚举、钳制数值。
 */
export function decodeFields<F extends FrameFields>(
  fields: F,
  raw: Readonly<Record<string, unknown>>,
  path = 'data',
): FrameData<F> {
  const out: Record<string, unknown> = {};
  for (const [prop, spec] of Object.entries(fields)) {
    out[prop] = decodeField(spec, raw[spec.wire], `${path}.${spec.wire}`);
  }
  // out 的每个键都按 fields 的声明填过了，这个断言与上面的循环一一对应。
  return out as FrameData<F>;
}

/** encodeFields 把帧对象映射回线路上的 snake_case data。 */
export function encodeFields<F extends FrameFields>(
  fields: F,
  value: FrameData<F>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [prop, spec] of Object.entries(fields)) {
    const own = (value as Record<string, unknown>)[prop];
    out[spec.wire] = encodeField(spec, own);
  }
  return out;
}

function decodeField(spec: FieldSpec, value: unknown, path: string): unknown {
  if (value === undefined) return defaultOf(spec);

  switch (spec.kind) {
    case 'string':
      return expectString(value, path);
    case 'bool':
      // 布尔必须是真布尔：0/1/"true" 一律拒（§2.4「禁止用 0/1 代替」）。
      if (typeof value !== 'boolean') throw badParams(`${path} 必须是布尔，得到 ${typeOf(value)}`);
      return value;
    case 'int':
      return coerceInt(expectInt(value, path), spec.min, spec.max, spec.outOfRange);
    case 'enum':
      return normalizeEnum(expectString(value, path), spec.values, spec.fallback);
    case 'stringArray':
      return expectArray(value, path).map((item, i) => expectString(item, `${path}[${i}]`));
    case 'enumArray':
      return expectArray(value, path).map((item, i) =>
        normalizeEnum(expectString(item, `${path}[${i}]`), spec.values, spec.fallback),
      );
    case 'objectArray':
      return expectArray(value, path).map((item, i) =>
        decodeFields(spec.fields, expectObject(item, `${path}[${i}]`), `${path}[${i}]`),
      );
    case 'object':
      return decodeFields(spec.fields, expectObject(value, path), path);
  }
}

function encodeField(spec: FieldSpec, value: unknown): unknown {
  if (value === undefined) return defaultOf(spec);
  if (spec.kind === 'objectArray') {
    return expectArray(value, spec.wire).map((item) =>
      encodeFields(spec.fields, item as FrameData<FrameFields>),
    );
  }
  if (spec.kind === 'object') {
    return encodeFields(spec.fields, value as FrameData<FrameFields>);
  }
  return value;
}

/**
 * defaultOf 给出字段的协议默认值。
 *
 * **数组的默认值恒为空数组，绝不是 null/undefined**——协议里没有 null，
 * 而 JSON.stringify 会把 undefined 字段整个丢掉，导致「本该有的空数组不见了」。
 */
function defaultOf(spec: FieldSpec): unknown {
  switch (spec.kind) {
    case 'string':
      return spec.default ?? '';
    case 'int':
      return spec.default ?? 0;
    case 'bool':
      return spec.default ?? false;
    case 'enum':
      return spec.default ?? spec.fallback;
    case 'stringArray':
    case 'enumArray':
    case 'objectArray':
      return [];
    case 'object':
      return decodeFields(spec.fields, {});
  }
}

function normalizeEnum(value: string, values: readonly string[], fallback: string): string {
  return values.includes(value) ? value : fallback;
}

function coerceInt(
  value: number,
  min: number | undefined,
  max: number | undefined,
  outOfRange: number | undefined,
): number {
  const belowMin = min !== undefined && value < min;
  const aboveMax = max !== undefined && value > max;
  if (!belowMin && !aboveMax) return value;
  if (outOfRange !== undefined) return outOfRange;
  return belowMin ? (min as number) : (max as number);
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw badParams(`${path} 必须是字符串，得到 ${typeOf(value)}`);
  return value;
}

function expectInt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw badParams(`${path} 必须是整数，得到 ${typeOf(value)}`);
  }
  return value;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw badParams(`${path} 必须是数组，得到 ${typeOf(value)}`);
  return value;
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw badParams(`${path} 必须是对象，得到 ${typeOf(value)}`);
  }
  // 已确认是非数组的普通对象。
  return value as Record<string, unknown>;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function badParams(reason: string): RtcError {
  return new RtcError(ErrorCode.badParams, { cause: new Error(reason) });
}
