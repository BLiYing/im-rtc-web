#!/usr/bin/env node
// 把 im-rtc-server/docs/i18n/strings.json（跨端文案表，单一真相源）生成成
// packages/call-uikit-react/src/i18n/messages.gen.ts。生成物提交进仓（npm 包不依赖同级仓）。
//   node scripts/gen-i18n.mjs          重新生成
//   node scripts/gen-i18n.mjs --check  与已提交的不一致就失败（test.sh 用）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.env.RTC_I18N_FILE ?? resolve(root, '../im-rtc-server/docs/i18n/strings.json');
const out = resolve(root, 'packages/call-uikit-react/src/i18n/messages.gen.ts');

if (!existsSync(src)) {
  console.error(`✗ 找不到文案表：${src}\n  把 im-rtc-server 克隆到本仓同级，或设 RTC_I18N_FILE。`);
  process.exit(1);
}
const { locales, strings } = JSON.parse(readFileSync(src, 'utf8'));
for (const [key, row] of Object.entries(strings)) {
  for (const l of locales) if (typeof row[l] !== 'string' || row[l] === '') {
    console.error(`✗ ${key} 缺 ${l}`); process.exit(1);
  }
}
const q = (s) => JSON.stringify(s);
const keys = Object.keys(strings);
const body = locales.map((l) =>
  `  ${q(l)}: {\n${keys.map((k) => `    ${q(k)}: ${q(strings[k][l])},`).join('\n')}\n  },`).join('\n');
const text = `// 由 scripts/gen-i18n.mjs 生成，勿手改。源：im-rtc-server/docs/i18n/strings.json\n\n` +
  `export const LOCALES = ${JSON.stringify(locales)} as const;\nexport type Locale = (typeof LOCALES)[number];\n\n` +
  `export type MessageKey =\n${keys.map((k) => `  | ${q(k)}`).join('\n')};\n\n` +
  `export const MESSAGES: Record<Locale, Record<MessageKey, string>> = {\n${body}\n};\n`;

if (process.argv.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== text) {
    console.error('✗ messages.gen.ts 与文案表不一致，跑 node scripts/gen-i18n.mjs'); process.exit(1);
  }
  console.log(`  ${keys.length} 条文案，与生成物一致`);
} else {
  writeFileSync(out, text);
  console.log(`  生成 ${keys.length} 条 × ${locales.length} 种语言`);
}
