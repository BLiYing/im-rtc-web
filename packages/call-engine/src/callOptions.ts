import { byteLength } from './bytes.js';

/**
 * CallOptions 是 {@link CallEngine.call} 的可选项（HOST_INTEGRATION_DESIGN §3.3）。
 *
 * 传布尔值等同旧的 `isGroup` 参数（三参数签名保持兼容）。
 *
 * 单拎一个模块（而不是留在 engine.ts 里）：CONVENTIONS §2 把 engine.ts 的体量红线
 * 卡得很紧——它是公开门面，一度正好顶到旧的 400 行阈值。校验逻辑是纯函数，
 * 值得像 `protocolId.ts` 那样独立成模块直接单测，也让门面文件少扛一份重量。
 */
export interface CallOptions {
  isGroup?: boolean;
  /** 宿主自己的群号，≤64 字节、禁止空白与换行；超限本地就地拒掉，见 `CallEngine.call`。 */
  chatGroupId?: string;
  /** opaque 字符串，≤4096 字节，原样透传给被叫与 webhook。 */
  userData?: string;
  /** 振铃超时秒数，默认 30，范围 5~120（越界服务端钳到边界）。 */
  timeoutSec?: number;
}

/** 协议 §2.6：chat_group_id 的字节上限。 */
const MAX_CHAT_GROUP_ID_BYTES = 64;
/** 协议 §2.6：user_data 的字节上限。 */
const MAX_USER_DATA_BYTES = 4096;

/**
 * violatesCallOptionLimits 报告 `chatGroupId` / `userData` 是不是超了协议 §2.6 的限额。
 *
 * 只判断、不抛错、不记日志——那两件事各自的语境不同（`engine.ts` 的 `call()` 要
 * 就地拒掉并抛 `error` 事件），调用方按自己的出口处理。空串永远不算违规
 * （`''` 表示宿主没给这个可选项）。
 */
export function violatesCallOptionLimits(chatGroupId: string, userData: string): boolean {
  if (chatGroupId !== '' && (byteLength(chatGroupId) > MAX_CHAT_GROUP_ID_BYTES || /\s/.test(chatGroupId))) {
    return true;
  }
  return byteLength(userData) > MAX_USER_DATA_BYTES;
}
