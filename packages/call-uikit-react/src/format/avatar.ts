import { avatarGradients } from '../theme.js';

/**
 * fnv1a32 是 32 位 FNV-1a。**四端共用这一个哈希**（规范 §02）：
 * 头像取色要稳定——同一个 uid 在你手机上是紫的、在对方电脑上是绿的，那就是 bug。
 * 选 FNV-1a 是因为它十行就能在 Swift / Kotlin / C++ 里写出一样的结果，
 * 不像 `String.hashCode` 各语言各一套。
 */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    // 乘 16777619，用移位拆开以留在 32 位无符号范围内。
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/** avatarIndex 把 uid 映射到九色板的下标。 */
export function avatarIndex(uid: string): number {
  return fnv1a32(uid) % avatarGradients.length;
}

/** avatarGradient 返回该 uid 的头像渐变底。 */
export function avatarGradient(uid: string): string {
  // 色板固定九项，下标一定在范围内；`?? ''` 只是让 noUncheckedIndexedAccess 闭嘴。
  return avatarGradients[avatarIndex(uid)] ?? '';
}

/** avatarInitial 取首字母（没有头像图时显示在渐变底上）。 */
export function avatarInitial(label: string): string {
  return label.trim().slice(0, 1).toUpperCase() || '?';
}
