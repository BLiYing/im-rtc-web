import { defineConfig } from 'vite';

/**
 * 两个 Demo 是**两条集成路线**的示范，不是同一个东西的两个版本：
 *   demo（5178）      只引 engine，界面全自己画；
 *   demo-react（5179）引 uikit，一行界面都不写。
 * 两个都要能跑，才说明「回调表够用」这件事是真的。
 */
export default defineConfig({
  server: { port: 5179, strictPort: true },
  resolve: {
    // 直接指到源码：改 engine / uikit 不用先 build 一次。
    alias: {
      '@im-rtc/call-engine': new URL('../packages/call-engine/src/index.ts', import.meta.url).pathname,
      '@im-rtc/call-uikit-react': new URL('../packages/call-uikit-react/src/index.ts', import.meta.url).pathname,
      '@demo/synthetic': new URL('../demo/src/syntheticMedia.ts', import.meta.url).pathname,
      '@demo/connection-guard':
        new URL('../demo/src/connectionGuard.ts', import.meta.url).pathname,
    },
  },
});
