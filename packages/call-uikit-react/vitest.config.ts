import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // uikit 是 UI，**时序与订阅类行为一律在 jsdom 里测**（CONVENTIONS §9）：
    // 浏览器里靠肉眼看订阅有没有清理是看不出来的。
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
