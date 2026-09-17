import { defineConfig } from 'vite';

import { resolveSdkAlias } from '../scripts/lib/sdkAlias';

/**
 * 两个 Demo 是**两条集成路线**的示范，不是同一个东西的两个版本：
 *   demo（5178）      只引 engine，界面全自己画；
 *   demo-react（5179）引 uikit，一行界面都不写。
 * 两个都要能跑，才说明「回调表够用」这件事是真的。
 *
 * IMRTC_SDK=source（默认）/ local / public —— 见 scripts/lib/sdkAlias.ts 与
 * scripts/pack-sdk.sh。local / public 两档验证的是「发出去的包本身能用」，
 * Demo 在那两档里等于一个第三方宿主。
 */
const repoRoot = new URL('..', import.meta.url).pathname;
const { alias: sdkAlias, logLine } = resolveSdkAlias(repoRoot, {
  'im-rtc-call-engine': 'packages/call-engine/src/index.ts',
  'im-rtc-call-uikit-react': 'packages/call-uikit-react/src/index.ts',
});
// demo-react/ 目前不在 check-logging.sh 的扫描范围内（current_task.md 已知坑），
// 这里就算不豁免也不会被拦；理由同 demo/vite.config.ts：构建期一次性提示。
console.log(`[demo-react] ${logLine}`);

export default defineConfig({
  server: { port: 5179, strictPort: true },
  resolve: {
    alias: {
      ...sdkAlias,
      '@demo/synthetic': new URL('../demo/src/syntheticMedia.ts', import.meta.url).pathname,
      '@demo/connection-guard':
        new URL('../demo/src/connectionGuard.ts', import.meta.url).pathname,
      '@demo/api': new URL('../demo/src/api.ts', import.meta.url).pathname,
    },
    // local / public 档下 uikit 自己 import 'react' 时，别再解出第二份 React——
    // 那份没有走 npm 安装、不带 peer 依赖，唯一的 React 副本应该就是仓库根的那份。
    dedupe: ['react', 'react-dom'],
  },
});
