import type { FrameFields } from './fieldSpec.js';

/**
 * 线路的 snake_case 与 TS 惯用的 camelCase 之间的两个方向。
 *
 * 抽成独立模块不只是为了 engine.ts 的体量：这两个函数是**纯的**，
 * 值得直接单测，而门面上的方法只能靠端到端间接覆盖。
 */

/** snakeToCamel 把 `media_type` 变成 `mediaType`。 */
export function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

/** camelizeArgs 把状态机产出的 snake_case 参数整体转成 camelCase。 */
export function camelizeArgs(args: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) out[snakeToCamel(key)] = value;
  return out;
}

/**
 * toFrameProps 把线路形状的 data 转成字段声明用的属性名。
 *
 * 两种键都认：状态机产出的是线路名（`track_id`），而调用方手写时更可能用属性名。
 * **认两种不是含糊**——字段声明里 `wire` 与属性名是一对一的，转换没有歧义。
 */
export function toFrameProps(
  fields: FrameFields,
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [prop, spec] of Object.entries(fields)) {
    if (Object.hasOwn(data, spec.wire)) out[prop] = data[spec.wire];
    else if (Object.hasOwn(data, prop)) out[prop] = data[prop];
  }
  return out;
}
