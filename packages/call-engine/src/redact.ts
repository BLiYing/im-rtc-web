/**
 * 脱敏：与服务端 `internal/observability` 的 Redact* 系列**行为一致**。
 *
 * 为什么 SDP 也算敏感：它带 ICE 候选（暴露内网拓扑与公网地址）、DTLS 指纹、
 * 以及 SRTP 的密钥协商材料。整条打进日志等于把一次通话的传输面摊开。
 * 要看完整 SDP 请用 Chrome 的 `webrtc-internals`，不要靠日志。
 */

/** 凭据保留的前缀长度。6 位够在日志里比对「是不是同一枚票」，又不足以伪造。 */
const REDACT_PREFIX_LEN = 6;

/** redact 把凭据折成「前 6 位 + 长度」。token / roomToken 进日志前必须过它。 */
export function redact(secret: string | undefined | null): string {
  if (secret === undefined || secret === null || secret === '') return '(empty)';
  if (secret.length <= REDACT_PREFIX_LEN) return `(len=${secret.length})`;
  return `${secret.slice(0, REDACT_PREFIX_LEN)}…(len=${secret.length})`;
}

/** redactSdp 把 SDP 折成「行数 + m= 行摘要」，够判断协商的是音频还是视频。 */
export function redactSdp(sdp: string | undefined | null): string {
  if (sdp === undefined || sdp === null || sdp === '') return '(empty)';
  const lines = sdp.split('\n');
  const media = lines
    .filter((line) => line.startsWith('m='))
    .map((line) => line.trim().split(/\s+/)[0] ?? '');
  return `sdp(lines=${lines.length}, ${media.join(',')})`;
}

/**
 * redactCandidate 把 ICE 候选折成「传输协议/类型」，不带地址与端口。
 *
 * 排查连通性看的是**候选类型分布**（host/srflx/relay）与最终选中的那一对，
 * 不是每条候选的地址。
 */
export function redactCandidate(candidate: string | undefined | null): string {
  if (candidate === undefined || candidate === null || candidate === '') {
    return '(end-of-candidates)';
  }
  const fields = candidate.split(/\s+/);
  let transport = '?';
  let type = '?';
  fields.forEach((field, i) => {
    const lower = field.toLowerCase();
    if (lower === 'udp' || lower === 'tcp') transport = lower;
    if (lower === 'typ') type = fields[i + 1] ?? '?';
  });
  return `candidate(${transport}/${type})`;
}
