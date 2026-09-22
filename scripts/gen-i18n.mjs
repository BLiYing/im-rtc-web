#!/usr/bin/env node
// 把 im-rtc-server/docs/i18n/strings.json（跨端文案表，单一真相源）生成成
// packages/call-uikit-react/src/i18n/messages.gen.ts；`demo.` 开头的 key 是 Demo 页面自己的文案，
// 不进 SDK，单独生成到 demo-react/src/demoMessages.gen.ts。生成物提交进仓（npm 包不依赖同级仓）。
//   node scripts/gen-i18n.mjs          重新生成
//   node scripts/gen-i18n.mjs --check  与已提交的不一致就失败（test.sh 用）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.env.RTC_I18N_FILE ?? resolve(root, '../im-rtc-server/docs/i18n/strings.json');
const out = resolve(root, 'packages/call-uikit-react/src/i18n/messages.gen.ts');
const demoOut = resolve(root, 'demo-react/src/demoMessages.gen.ts');

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
const isDemo = (k) => k.startsWith('demo.');

function render(keys, typeName, constName, comment) {
  const body = locales.map((l) =>
    `  ${q(l)}: {\n${keys.map((k) => `    ${q(k)}: ${q(strings[k][l])},`).join('\n')}\n  },`).join('\n');
  return { count: keys.length, text: `// 由 scripts/gen-i18n.mjs 生成，勿手改。源：im-rtc-server/docs/i18n/strings.json${comment}\n\n` +
    (typeName === 'MessageKey'
      ? `export const LOCALES = ${JSON.stringify(locales)} as const;\nexport type Locale = (typeof LOCALES)[number];\n\n`
      : `import type { Locale } from 'im-rtc-call-uikit-react';\n\n`) +
    `export type ${typeName} =\n${keys.map((k) => `  | ${q(k)}`).join('\n')};\n\n` +
    `export const ${constName}: Record<Locale, Record<${typeName}, string>> = {\n${body}\n};\n` };
}
const all = Object.keys(strings);
const sdk = render(all.filter((k) => !isDemo(k)), 'MessageKey', 'MESSAGES', '');
const demo = render(all.filter(isDemo), 'DemoKey', 'DEMO_MESSAGES', '（仅 demo. 开头的 key）');
const targets = [[out, sdk], [demoOut, demo]];

if (process.argv.includes('--check')) {
  for (const [file, r] of targets) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== r.text) {
      console.error(`✗ ${file} 与文案表不一致，跑 node scripts/gen-i18n.mjs`); process.exit(1);
    }
  }
  console.log(`  ${sdk.count} 条 SDK 文案 + ${demo.count} 条 Demo 文案，与生成物一致`);
} else {
  for (const [file, r] of targets) writeFileSync(file, r.text);
  console.log(`  生成 ${sdk.count} 条 SDK + ${demo.count} 条 Demo × ${locales.length} 种语言`);
}
