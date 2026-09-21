import type { Locale, MessageKey } from './messages.gen.js';
import { LOCALES, MESSAGES } from './messages.gen.js';

export type { Locale, MessageKey } from './messages.gen.js';
export { LOCALES } from './messages.gen.js';

/** MessageOverrides 是宿主按语言覆盖的文案（只写要改的 key）。 */
export type MessageOverrides = Partial<Record<Locale, Partial<Record<MessageKey, string>>>>;

const SOURCE_LOCALE: Locale = 'zh-CN';

let current: Locale = SOURCE_LOCALE;
let overrides: MessageOverrides = {};

/**
 * setLocale 切换当前语言。`<CallProvider locale>` 在渲染时调它，宿主一般不必直接用。
 * 文案表是模块级的：reducer / 格式化函数这类非 React 代码也要出人话，没法都走 hook。
 */
export function setLocale(locale: Locale, custom: MessageOverrides = {}): void {
  current = locale;
  overrides = custom;
}

export function getLocale(): Locale {
  return current;
}

/** t 按当前语言取文案，`{name}` 占位符用 params 替换。缺译回落中文，再缺回落 key（一眼看得出漏了）。 */
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  const raw = overrides[current]?.[key] ?? MESSAGES[current]?.[key] ?? MESSAGES[SOURCE_LOCALE][key] ?? key;
  if (params === undefined) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/**
 * resolveLocale 把「跟随系统 / 具体语言」落成支持的语言。
 * 只认语言主码：`en-US`、`en-GB` 都归 `en`；`zh-*` 归 `zh-CN`；不认识的回落中文。
 */
export function resolveLocale(preference: Locale | 'auto', systemLanguages?: readonly string[]): Locale {
  if (preference !== 'auto') return preference;
  const langs = systemLanguages ?? (typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]);
  for (const lang of langs) {
    const primary = lang.toLowerCase().split('-')[0];
    if (primary === 'zh') return 'zh-CN';
    const hit = LOCALES.find((l) => l.toLowerCase().split('-')[0] === primary);
    if (hit !== undefined) return hit;
  }
  return SOURCE_LOCALE;
}
