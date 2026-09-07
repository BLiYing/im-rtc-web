import type {
  LocalTrackInfo,
  MediaAdapter,
  MediaAdapterEvents,
} from '../src/media/mediaAdapter.js';

/**
 * NullMedia 是什么都不做的媒体层。
 *
 * 给「只看信令与事件流」的用例用：不注入它的话，`engine.login()` 会去 new 真的
 * `RTCPeerConnection`，而 Node 下没有这个全局，测试直接崩在与被测行为无关的地方。
 */
export class NullMedia implements MediaAdapter {
  open(_events: MediaAdapterEvents): void {}

  async acquireMicrophone(): Promise<LocalTrackInfo> {
    return { cid: 'mic-1', kind: 'audio', source: 'microphone' };
  }

  async probeMicrophone(): Promise<void> {}

  async startLocalPreview(): Promise<LocalTrackInfo> {
    return this.acquireCamera();
  }

  async acquireCamera(): Promise<LocalTrackInfo> {
    return { cid: 'cam-1', kind: 'video', source: 'camera' };
  }

  async createPubOffer(): Promise<string> {
    return 'offer-sdp';
  }

  restartPubICE(): void {}

  async applyPubAnswer(): Promise<void> {}

  async answerSubOffer(): Promise<string> {
    return 'answer-sdp';
  }

  async addRemoteCandidate(): Promise<void> {}

  setMuted(): void {}

  localTrack(): MediaStreamTrack | undefined {
    return undefined;
  }

  close(): void {}
}
