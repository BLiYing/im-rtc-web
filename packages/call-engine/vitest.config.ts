import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // engine 必须能在无 DOM 的环境构造（CONVENTIONS §1）——
    // 一致性向量测试跑在 node 环境正是这条约束的体现。
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
