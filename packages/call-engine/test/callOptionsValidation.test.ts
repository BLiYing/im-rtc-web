import { describe, expect, it } from 'vitest';

import { violatesCallOptionLimits } from '../src/callOptions.js';

/**
 * `violatesCallOptionLimits` 是 `CallEngine.call()` 本地校验的纯逻辑那一半
 * （HOST_INTEGRATION_DESIGN §3.3：chatGroupId ≤64 字节且不许空白、userData ≤4096 字节）。
 * 门面那半（日志 + 出口）由 `test/callOptions.test.ts` 的 engine 级用例覆盖。
 */
describe('violatesCallOptionLimits', () => {
  it('空值不算违规', () => {
    expect(violatesCallOptionLimits('', '')).toBe(false);
  });

  it('64 字节以内的 chatGroupId 合规，65 字节起违规', () => {
    expect(violatesCallOptionLimits('g'.repeat(64), '')).toBe(false);
    expect(violatesCallOptionLimits('g'.repeat(65), '')).toBe(true);
  });

  it('chatGroupId 含空白 / 换行都算违规', () => {
    expect(violatesCallOptionLimits('g 42', '')).toBe(true);
    expect(violatesCallOptionLimits('g\n42', '')).toBe(true);
    expect(violatesCallOptionLimits('g\t42', '')).toBe(true);
  });

  it('4096 字节以内的 userData 合规，4097 字节起违规', () => {
    expect(violatesCallOptionLimits('', 'x'.repeat(4096))).toBe(false);
    expect(violatesCallOptionLimits('', 'x'.repeat(4097))).toBe(true);
  });

  it('按 UTF-8 字节数算，不是字符数（多字节字符更容易撞上限）', () => {
    // 每个中文字符在 UTF-8 下是 3 字节：22 个字符 = 66 字节，超过 64。
    const chatGroupId = '群'.repeat(22);
    expect(chatGroupId.length).toBeLessThanOrEqual(64); // 字符数没超，字节数超了
    expect(violatesCallOptionLimits(chatGroupId, '')).toBe(true);
  });
});
