import { ErrorCode, RtcError } from './errors.js';

/**
 * `device_id` 的入参校验（协议 §2.5）。
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
 * # 只校验，不改写
 *
 * `device_id` 要求**跨重启稳定**，SDK 悄悄替宿主改掉，宿主自己那套设备管理
 * （设备列表、注销设备、顶号）就跟服务端对不上账了。清洗是宿主的事。
 *
 * 真要清洗，**别用「删掉非法字符」那种做法**：`MI 8` 与 `MI8` 是两款不同的机器，
 * 删完就撞成同一个 device_id，而撞号的后果是两台设备互相顶号、轮流把对方踢下线。
 * 换成 `-` 才不会。
 */

/** 协议 §2.5：`device_id` ≤64 **字节**（不是字符）。 */
const MAX_DEVICE_ID_BYTES = 64;

const ALLOWED = /^[A-Za-z0-9_-]*$/;

/**
 * checkDeviceId 校验 `device_id`，不合规就抛 `RtcError(bad_params)`。
 *
 * 抛的码**和服务端拒绝时是同一个 1004**——宿主那套按 code 分支的错误处理不用为
 * 「本地拦下的」和「服务端拒的」写两遍，具体哪里不对看 `cause`。
 *
 * 宿主也可以自己先调它验一遍自己生成的 id，不必等到 `login()`。
 */
export function checkDeviceId(deviceId: string): void {
  if (deviceId === '') {
    throw new RtcError(ErrorCode.badParams, {
      cause: new Error('device_id 不能为空（协议 §2.5）'),
    });
  }
  const bytes = new TextEncoder().encode(deviceId).length;
  if (bytes > MAX_DEVICE_ID_BYTES) {
    throw new RtcError(ErrorCode.badParams, {
      cause: new Error(`device_id 长 ${bytes} 字节，上限 ${MAX_DEVICE_ID_BYTES}（协议 §2.5）`),
    });
  }
  if (!ALLOWED.test(deviceId)) {
    const bad = [...deviceId].find((ch) => !ALLOWED.test(ch));
    throw new RtcError(ErrorCode.badParams, {
      cause: new Error(
        `device_id 只允许 [A-Za-z0-9_-]，出现了 '${bad}'（协议 §2.5）。` +
          '拿 userAgent 之类拼 id 的话记得先清洗——里面空格和括号是常态',
      ),
    });
  }
}
