/**
 * UTF-8 字节数。
 *
 * **单拎一个模块，是因为协议的上限全是「字节」不是「字符」**——§2.5 的那一列 id、
 * §2.6 的单帧上限，都按字节判。这条规则一旦有两份实现就会各修各的，而两处判断不
 * 一致时的症状最难查：本地按字符算放行、服务端按字节算拒掉，宿主看到的是一个
 * 「明明校验过了却还是被拒」的 1004。
 */

/**
 * 复用同一个编码器。
 *
 * `TextEncoder` 是无状态的（`encode()` 不像 `encodeInto()` 那样带游标），
 * 复用没有线程/重入问题；而这两条调用路径都在热路上——每发一帧走一次。
 */
const encoder = new TextEncoder();

/** byteLength 按 UTF-8 计算字节数——协议的上限是**字节**不是字符。 */
export function byteLength(value: string): number {
  return encoder.encode(value).length;
}
