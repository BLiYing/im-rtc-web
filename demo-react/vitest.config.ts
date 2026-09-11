import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

/**
 * demo-react 只测**抽出来的纯逻辑**（设置读写、UA 缩写），界面仍靠浏览器里点。
 * 沿用 vite.config 的别名，`@im-rtc/call-engine` 才会指到源码而不是还没 build 的 dist。
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['test/**/*.test.ts'],
    },
  }),
);
