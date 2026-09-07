import { byteLength } from './bytes.js';
import { ErrorCode, RtcError } from './errors.js';
import { logger } from './logger.js';

/**
 * §2.5 那一列 id 的入参校验：非空、≤64 **字节**、charset `[A-Za-z0-9_-]`。
 *
 * # 为什么要在端上拦一道
 *
 * **不拦的症状是「登录失败，没有下文」**：服务端回 1004，客户端握手失败，
 * 而服务端那句说得很清楚的「device_id 只允许 [A-Za-z0-9_-]」**到不了宿主手里**——
 * 宿主看到的只有一个 `bad_params`。安卓真机上踩过一次（`Build.MODEL` 是
 * `Pixel 2 XL`，带空格），查了一轮才定位到是机型名。
 *
 * Web 上最常见的错法是拿浏览器信息拼 id：`navigator.platform` 是 `MacIntel` 没事，
 * 但 `navigator.userAgent` 里到处是空格、斜杠和括号，UUID 带的连字符倒是合规的。
 *
 * # 为什么是通用的 id 校验，不是 device_id 专用
 *
 * §2.5 里 `device_id` / `room_id` / `cid` 是**同一条约束**，踩的也是同一个坑：
 * 宿主指定的值不合规 → 服务端 1004 → 宿主只看到 `bad_params`。一个字段写一份
 * 校验的话，下一个字段会把这一轮排查重新踩一遍——`joinRoom(roomId)` 就是现成的
 * 下一个（宿主拿群名当房间号，中文和空格一起来）。
 *
 * # 为什么这里要记日志
 *
 * `cause` 按 `errors.ts` 的约定**只进日志、不进 UI**，所以光把原因塞进 `cause`
 * 并不能把它送到宿主手里——宿主的 catch 里 `String(err)` 只有那句固定短语。
 * 这条 `logger.warn` 才是原因唯一的落点：诊断环形缓冲不受 `setLogLevel` 影响，
 * 用户点「报告问题」调 `exportDiagnostics()` 时它还在。
 *
 * # 只校验，不改写
 *
 * 这些 id 要求**跨重启稳定**，SDK 悄悄替宿主改掉，宿主自己那套设备管理
 * （设备列表、注销设备、顶号）就跟服务端对不上账了。清洗是宿主的事。
 *
 * 真要清洗，**别用「删掉非法字符」那种做法**：`MI 8` 与 `MI8` 是两款不同的机器，
 * 删完就撞成同一个 device_id，而撞号的后果是两台设备互相顶号、轮流把对方踢下线。
 * 换成 `-` 才不会。
 */

/** 协议 §2.5：这一列 id 都是 ≤64 **字节**（不是字符）。 */
const MAX_ID_BYTES = 64;

/**
 * 用 `+` 而不是 `*`：空串该由这条正则自己拒掉。
 *
 * 写成 `*` 的话空串能过 charset 这关，于是「先查空、再查 charset」的**顺序**
 * 变成了正确性的一部分——下一个人合并两个分支或者换个地方复用它，空串就悄悄放行了。
 */
const ALLOWED = /^[A-Za-z0-9_-]+$/;

/**
 * checkProtocolId 校验一个 §2.5 的 id，不合规就记一条日志再抛 `RtcError(bad_params)`。
 *
 * 抛的码**和服务端拒绝时是同一个 1004**——宿主那套按 code 分支的错误处理不用为
 * 「本地拦下的」和「服务端拒的」写两遍，具体哪里不对看日志。
 *
 * `value` 收 `unknown` 而不是 `string`：这是**公开导出的入口**，宿主可能是 JS，
 * 也可能把一个没取到的配置项直接传进来。详见下面第一道检查。
 */
function checkProtocolId(field: string, value: unknown, hint: string): void {
  /*
    **先挡非字符串**，不然 `undefined` 会一路放行到线路上：
    `undefined === ''` 是 false；`TextEncoder.encode(undefined)` 按规范把参数
    默认成 `''`，算出来 0 字节；而 `ALLOWED.test(undefined)` 会先把它转成字符串
    `'undefined'`——正好全是合规字符。三关全过，然后服务端拒掉，
    症状又回到这个模块存在的理由本身。
  */
  if (typeof value !== 'string') {
    throw reject(field, value, `${field} 必须是字符串，得到 ${describe(value)}（协议 §2.5）`);
  }
  if (value === '') {
    throw reject(field, value, `${field} 不能为空（协议 §2.5）`);
  }
  const bytes = byteLength(value);
  if (bytes > MAX_ID_BYTES) {
    throw reject(field, value, `${field} 长 ${bytes} 字节，上限 ${MAX_ID_BYTES}（协议 §2.5）`);
  }
  if (!ALLOWED.test(value)) {
    // 逐个码点找，好把「到底是哪个字符」说出来——`[...str]` 按码点切，
    // emoji 那种四字节的不会被劈成两个半拉代理对。
    const bad = [...value].find((ch) => !ALLOWED.test(ch));
    throw reject(
      field,
      value,
      `${field} 只允许 [A-Za-z0-9_-]，出现了 '${String(bad)}'（协议 §2.5）。${hint}`,
    );
  }
}

/** describe 给非字符串取一个能读的类型名——`typeof null` 是 'object'，单独说。 */
function describe(value: unknown): string {
  return value === null ? 'null' : typeof value;
}

/** reject 记一条日志再造错误。**日志是原因唯一到得了宿主的通道**，见文件头。 */
function reject(field: string, value: unknown, reason: string): RtcError {
  logger.warn('入参 id 不合规，就地拒掉', { field, value: String(value), reason });
  return new RtcError(ErrorCode.badParams, { cause: new Error(reason) });
}

/**
 * checkDeviceId 校验 `device_id`。
 *
 * 宿主也可以自己先调它验一遍生成的 id，不必等到 `login()`。
 */
export function checkDeviceId(deviceId: string): void {
  checkProtocolId(
    'device_id',
    deviceId,
    '拿 userAgent 之类拼 id 的话记得先清洗——里面空格和括号是常态',
  );
}

/**
 * checkRoomId 校验宿主指定的 `room_id`。
 *
 * 服务端分配的房间号必然合规，这道检查是给 `joinRoom(roomId)` 这种**宿主自己
 * 指定房间号**的用法的——拿群名当房间号是最常见的写法，而群名里什么都有。
 */
export function checkRoomId(roomId: string): void {
  checkProtocolId('room_id', roomId, '别直接拿群名当房间号——中文、空格都会被拒');
}
