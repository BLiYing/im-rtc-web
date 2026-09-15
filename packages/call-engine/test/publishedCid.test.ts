import { describe, expect, it } from 'vitest';

import type { MediaSource } from '../src/media/mediaAdapter.js';
import { WebRTCAdapter } from '../src/media/webrtcAdapter.js';

/*
  `publishedMicrophoneCid` / `publishedCameraCid`：CallEngine.openMicrophone / openCamera
  靠它们判断「这个类型的轨道发没发布过」（engine.ts 的注释里记着为什么不能在门面自己另开
  一份账——2026-09-15 iOS 在等价实现上踩过：宿主先直接调 publishMicrophone() / publishCamera()
  发布过，门面自己那份影子账不知道，再调 open*() 就会判成「没发布」而重复发布）。

  所以这两个查询方法必须问适配器自己**真实**记的账，不能是另一份复制。
*/

/** 一条最小的假音频轨道；只要 id 与 stop() 就够走通麦克风的发布路径。 */
function fakeAudioSource(id: string): { source: MediaSource; stopped: boolean[] } {
  const stopped: boolean[] = [];
  const track = { id, kind: 'audio', enabled: true, stop: () => stopped.push(true) };
  const source: MediaSource = {
    getStream: async () =>
      ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream,
  };
  return { source, stopped };
}

/** withPub 塞一条假的 pub：麦克风走 addTrack，摄像头走 addTransceiver。 */
function withPub(adapter: WebRTCAdapter): void {
  const sender = { getParameters: () => ({ encodings: [] }), setParameters: async () => undefined };
  Reflect.set(adapter, 'pub', {
    addTransceiver: () => ({ sender }),
    addTrack: () => sender,
    close: () => undefined,
  });
}

describe('publishedMicrophoneCid', () => {
  it('没发布过是 null；acquireMicrophone 之后是它的 cid；close() 之后清零', async () => {
    const { source } = fakeAudioSource('mic-1');
    const adapter = new WebRTCAdapter(source);
    withPub(adapter);
    expect(adapter.publishedMicrophoneCid()).toBeNull();

    await adapter.acquireMicrophone();
    expect(adapter.publishedMicrophoneCid()).toBe('mic-1');

    adapter.close();
    expect(adapter.publishedMicrophoneCid()).toBeNull();
  });
});

describe('publishedCameraCid', () => {
  /** camSource 只在这个 describe 里用，摄像头轨道要走 video 分支。 */
  function camSource(id: string): MediaSource {
    const track = { id, kind: 'video', enabled: true, stop: () => undefined };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    return { getStream: async () => stream };
  }

  it('只起预览（没发布）时是 null——预览不等于已发布', async () => {
    const adapter = new WebRTCAdapter(camSource('cam-1'));
    await adapter.startLocalPreview();
    expect(adapter.publishedCameraCid()).toBeNull();
  });

  it('acquireCamera 发布之后是它的 cid；close() 之后清零', async () => {
    const adapter = new WebRTCAdapter(camSource('cam-1'));
    withPub(adapter);
    await adapter.acquireCamera(true);
    expect(adapter.publishedCameraCid()).toBe('cam-1');

    adapter.close();
    expect(adapter.publishedCameraCid()).toBeNull();
  });
});
