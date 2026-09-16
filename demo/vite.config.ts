import { defineConfig } from 'vite';

import { resolveSdkAlias } from '../scripts/lib/sdkAlias';

// IMRTC_SDK=source（默认）/ local / public —— 见 scripts/lib/sdkAlias.ts 与
// scripts/pack-sdk.sh。local / public 两档验证的是「发出去的包本身能用」，
// Demo 在那两档里等于一个第三方宿主。
const repoRoot = new URL('..', import.meta.url).pathname;
const { alias, logLine } = resolveSdkAlias(repoRoot, {
  'im-rtc-call-engine': 'packages/call-engine/src/index.ts',
});
// 这里直接用 console：构建期一次性提示，不是业务日志，check-logging.sh 对
// */vite.config.ts 有专门豁免（见该脚本注释）。
console.log(`[demo] ${logLine}`);

export default defineConfig({
  server: { port: 5178, strictPort: true },
  resolve: {
    alias,
    // local / public 档下 SDK 包自己 import 'react' 时，别再解出第二份 React——
    // 否则 demo-react 侧会报 Invalid hook call（demo 本身不用 React，这里加上是为了
    // 两个 vite.config.ts 保持同一套 resolve 规则，互相好对照）。
    dedupe: ['react', 'react-dom'],
  },
});
