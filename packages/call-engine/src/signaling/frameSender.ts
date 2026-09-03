import type { MediaAdapter } from '../media/mediaAdapter.js';
import { toFrameProps } from './caseMapping.js';
import type { Connection } from './connection.js';
import type { PcRole } from './enums.js';
import { lookupFrame } from './registry.js';

/**
 * FrameSender 把状态机产出的**意图**变成线路上的一帧。
 *
 * # 为什么这一层要单独存在
 *
 * 状态机是纯函数，产不出 SDP——它给的协商帧 `sdp` 字段是空的。
 * 「取真值填进去」这件事既要碰媒体层又要碰连接，放在状态机里会毁掉它的可测性，
 * 放在门面里则让门面同时管路由、填 SDP 和事件三件事。所以单独一层：
 * **门面只管把帧交给它，它只管把帧变成真的**。
 */
export class FrameSender {
  private readonly media: MediaAdapter;
  /** 服务端最近一次下发的 sub offer，答复时要用。 */
  private lastSubOfferSdp = '';

  constructor(media: MediaAdapter) {
    this.media = media;
  }

  /** noteSubOffer 记下服务端下发的 sub offer。**答复它时才有得可答**。 */
  noteSubOffer(sdp: string): void {
    this.lastSubOfferSdp = sdp;
  }

  /**
   * send 发一帧并返回应答（`{type, data}`）。
   *
   * 返回应答而不是直接消化掉：**`.ok` 也要喂回状态机**——join.ok / publish.ok
   * 都是状态推进的关键一步，漏掉那一半会让房间永远停在 `joining`。
   */
  async send(
    connection: Connection,
    type: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<{ type: string; data: Record<string, unknown> } | null> {
    const fields = lookupFrame(type);
    if (fields === undefined) return null;

    const filled: Record<string, unknown> = { ...data };
    if (type === 'room.offer' && filled['pc'] === 'pub') {
      filled['sdp'] = await this.media.createPubOffer();
    } else if (type === 'room.answer' && filled['pc'] === 'sub') {
      filled['sdp'] = await this.media.answerSubOffer(this.lastSubOfferSdp);
    }
    const reply = await connection.request(type, fields, toFrameProps(fields, filled));
    return { type: reply.envelope.type, data: reply.data };
  }

  /** sendCandidate 发一个本端候选。候选是尽力而为的，失败由调用方转成 error 事件。 */
  async sendCandidate(
    connection: Connection,
    pc: PcRole,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    const fields = lookupFrame('room.ice_candidate');
    if (fields === undefined) return;
    await connection.request('room.ice_candidate', fields, {
      pc,
      candidate: candidate.candidate ?? '',
      sdpMid: candidate.sdpMid ?? '',
      sdpMLineIndex: candidate.sdpMLineIndex ?? 0,
    });
  }
}
