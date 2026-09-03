import type { PcRole } from './enums.js';

/**
 * 把线路上的 `room.ice_candidate` data 解析成浏览器要的 `RTCIceCandidateInit`。
 *
 * 抽成纯函数不只是为了门面的体量：它有两条容易写错的规则，值得直接单测——
 * 而门面上的方法只能靠端到端间接覆盖。
 */
export interface ParsedCandidate {
  readonly pc: PcRole;
  readonly init: RTCIceCandidateInit;
}

/**
 * parseCandidate 解析一条候选；返回 `null` 表示**不需要加**。
 *
 * `candidate` 为空串是「收集结束」的信号（协议 §3.3），接收方必须容忍——
 * 把它当成一条真候选喂给 `addIceCandidate` 在部分浏览器上会抛。
 */
export function parseCandidate(data: Readonly<Record<string, unknown>>): ParsedCandidate | null {
  const candidate = typeof data['candidate'] === 'string' ? data['candidate'] : '';
  if (candidate === '') return null;

  const rawIndex = data['sdp_mline_index'];
  return {
    // 只有两条 PC；认不出来的一律当 sub——下行才是候选真正要紧的方向。
    pc: data['pc'] === 'pub' ? 'pub' : 'sub',
    init: {
      candidate,
      sdpMid: typeof data['sdp_mid'] === 'string' ? data['sdp_mid'] : '',
      sdpMLineIndex: typeof rawIndex === 'number' ? rawIndex : 0,
    },
  };
}
