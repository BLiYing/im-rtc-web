import { describe, expect, it } from 'vitest';

import { avatarGradient, avatarIndex, avatarInitial, fnv1a32 } from '../src/format/avatar.js';
import { avatarGradients } from '../src/theme.js';

/**
 * 头像取色（规范 §02）：`fnv1a32(uid) % 9`，**四端共用这一个哈希**。
 * 下面这些数就是给 Swift / Kotlin / C++ 对表用的向量——改了哈希这里会先红。
 */
describe('fnv1a32', () => {
  it('标准向量', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
  });

  it('四端对表用的 uid 向量', () => {
    expect(fnv1a32('alice')).toBe(2267157479);
    expect(fnv1a32('bob')).toBe(2261164244);
    expect(fnv1a32('carol')).toBe(1728614162);
    // 非 ASCII 走 UTF-8 字节，不是 UTF-16 码元。
    expect(fnv1a32('张三')).toBe(956401659);
  });
});

describe('头像色板', () => {
  it('同一个 uid 永远同一个颜色，且落在九色板里', () => {
    expect(avatarIndex('alice')).toBe(2267157479 % 9);
    expect(avatarGradient('alice')).toBe(avatarGradients[2267157479 % 9]);
    expect(avatarGradient('alice')).toBe(avatarGradient('alice'));
    expect(avatarGradients).toHaveLength(9);
  });

  it('首字母大写，空的给问号', () => {
    expect(avatarInitial('bob')).toBe('B');
    expect(avatarInitial('  ')).toBe('?');
    expect(avatarInitial('张三')).toBe('张');
  });
});
