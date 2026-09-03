import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5178, strictPort: true },
  resolve: {
    // 直接指到源码：改 engine 不用先 build 一次，Demo 立刻能看到效果。
    alias: { '@im-rtc/call-engine': new URL('../packages/call-engine/src/index.ts', import.meta.url).pathname },
  },
});
