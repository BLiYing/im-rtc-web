import { getLocale } from 'im-rtc-call-uikit-react';

import type { DemoKey } from './demoMessages.gen.js';
import { DEMO_MESSAGES } from './demoMessages.gen.js';

/**
 * dt 取 Demo 页面自己的文案（登录、拨号、记录、设置那些）。
 * 语言跟 SDK 走同一个开关（`getLocale()`），缺译回落中文；文案表与 SDK 的分开，别把 Demo 文案打进 SDK 包。
 */
export function dt(key: DemoKey, params?: Readonly<Record<string, string | number>>): string {
  const raw = DEMO_MESSAGES[getLocale()]?.[key] ?? DEMO_MESSAGES['zh-CN'][key] ?? key;
  if (params === undefined) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
