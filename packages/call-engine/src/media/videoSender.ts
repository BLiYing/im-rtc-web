import { logger } from '../logger.js';
import type { VideoProfile } from './videoProfile.js';
import { simulcastEncodings } from './videoProfile.js';

/*
  上行视频怎么挂到 pub 上、码率怎么压。

  从 `webrtcAdapter.ts` 里单拎出来：这两件事只读画质档位、只碰传进来的 PC 与 sender，
  **不碰适配器的任何状态**（预览、开关队列、代数那一套都不相干），
  拆出来之后可以直接对着假 PC 单测，不必再 `Reflect.get` 去掏私有方法。
*/

/**
 * addVideoSender 把一条上行视频挂到 pub 上，返回它的 sender。
 *
 * # 为什么不能用 addTrack
 *
 * `addTrack` 只会产生**一个 encoding**，浏览器里发 simulcast 必须在建
 * transceiver 时就把 `sendEncodings` 给出来——协商之后再 `setParameters`
 * 加层是加不上的（规范不允许改 encoding 的条数）。
 *
 * 这正是之前那个洞：`publishCamera(simulcast = true)` 的这个参数一路传进了
 * `room.publish` 帧、**告诉服务端「我是 simulcast」**，可媒体面走的是裸
 * `addTrack`，实际只发一层。服务端于是只看到空 RID 的单层（`ridToLayer("")`
 * 当成 h），层选择无从谈起：订阅者报 `l` 也只能收到全速率的 h
 * （`selectLayer` 的兜底），弱下行的那一方被自己的全速率流压死。
 *
 * `streams: [stream]` 不能省：msid 的第二段就是 cid，服务端靠它认领 m-line
 * （协议 §3.2）。省掉它服务端永远认不回这条轨道。
 */
export function addVideoSender(
  pub: RTCPeerConnection,
  track: MediaStreamTrack,
  stream: MediaStream,
  simulcast: boolean,
  video: VideoProfile,
): RTCRtpSender {
  if (!simulcast) {
    const sender = pub.addTrack(track, stream);
    applyVideoBitrate(sender, video);
    return sender;
  }
  const transceiver = pub.addTransceiver(track, {
    direction: 'sendonly',
    streams: [stream],
    sendEncodings: simulcastEncodings(video),
  });
  logger.info('上行视频已按 simulcast 发布', {
    cid: track.id,
    layers: simulcastEncodings(video).map((e) => e.rid).join(','),
  });
  applyVideoBitrate(transceiver.sender, video);
  return transceiver.sender;
}

/**
 * applyVideoBitrate 给上行视频压一个码率上限。
 *
 * **不设的话浏览器会自己往上飙**：Chrome 对 720p 的默认上限远高于我们给
 * simulcast h 层定的目标值，服务端的带宽预算（`bwe.go` 的 `bitrateHigh`）
 * 就成了一个对不上的数字，降层判断跟着不准。
 *
 * 失败只记日志：码率是画质偏好，`setParameters` 被拒不该让通话打不出去。
 */
function applyVideoBitrate(sender: RTCRtpSender, video: VideoProfile): void {
  const params = sender.getParameters();
  // encodings 可能还是空的（协商之前）；补一个默认项，浏览器会认。
  if (params.encodings.length === 0) params.encodings = [{}];
  /*
   **simulcast 的三层各有各的码率，不能抹平成同一个值。**
   全设成 h 的目标码率等于让 l / m 两层也按 1.5Mbps 发，
   上行瞬间涨到三倍，而降层根本省不下带宽——降了个寂寞。
   按 rid 对号入座；没有 rid（单层发布）才用整档的上限。
  */
  const byRid = new Map(simulcastEncodings(video).map((e) => [e.rid, e.maxBitrate]));
  for (const encoding of params.encodings) {
    encoding.maxBitrate = byRid.get(encoding.rid) ?? video.maxBitrateBps;
  }
  void sender.setParameters(params).catch((err: unknown) => {
    logger.info('设置上行码率失败，用浏览器默认值', { err: String(err) });
  });
}
