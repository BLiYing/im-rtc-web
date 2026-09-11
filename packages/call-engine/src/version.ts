/**
 * SDK_VERSION 是 im-rtc SDK 的版本号。
 *
 * **四端（iOS / Android / Web / 桌面）共用同一个版本号**，一起升。
 * 它会拼进 `sys.hello` 的 `sdk` 字段（`web/<版本>`），只用于日志与灰度，不参与任何逻辑（协议 §1.2）；
 * 宿主也可以拿它显示在「关于」里。
 *
 * 升版本时要同步改 `packages/call-engine/package.json` 与 `packages/call-uikit-react/package.json`。
 */
export const SDK_VERSION = '1.0.0';
