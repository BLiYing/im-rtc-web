import type { MediaSource } from '@im-rtc/call-engine';

/**
 * 合成音视频源：用 canvas 与 AudioContext 造轨道，**不碰摄像头与麦克风**。
 *
 * 存在的理由是端到端验证：真设备要弹权限、CI 里没有摄像头、
 * 而「画面到底通没通」又必须用真的 WebRTC 链路验。合成源两头都占。
 *
 * 画面上会画一个走动的秒针与用户名，所以**肉眼就能看出画面是活的还是冻住的**——
 * 静态图看不出「卡住了」和「通了」的区别。
 */
export class SyntheticMediaSource implements MediaSource {
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly label: string) {}

  async getStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
    const stream = new MediaStream();
    if (constraints.audio === true) stream.addTrack(this.audioTrack());
    if (constraints.video === true) stream.addTrack(this.videoTrack());
    return stream;
  }

  /** audioTrack 造一路 440Hz 正弦波——有声音才有 RTP 可转。 */
  private audioTrack(): MediaStreamTrack {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const destination = ctx.createMediaStreamDestination();

    oscillator.frequency.value = 440;
    gain.gain.value = 0.05; // 小声一点，两个标签页同时开着不至于刺耳
    oscillator.connect(gain).connect(destination);
    oscillator.start();

    this.cleanups.push(() => {
      oscillator.stop();
      void ctx.close();
    });
    const track = destination.stream.getAudioTracks()[0];
    if (track === undefined) throw new Error('合成音频源没产出轨道');
    return track;
  }

  /** videoTrack 造一路 320x240 的动画画面：走动的秒针 + 用户名。 */
  private videoTrack(): MediaStreamTrack {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('拿不到 2d 上下文');

    const timer = window.setInterval(() => {
      const now = Date.now() / 1000;
      ctx.fillStyle = '#12203a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = '#4fd1c5';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(160, 120);
      ctx.lineTo(160 + Math.cos(now) * 70, 120 + Math.sin(now) * 70);
      ctx.stroke();

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText(this.label, 12, 30);
      ctx.fillText(new Date().toLocaleTimeString(), 12, 226);
    }, 100);

    this.cleanups.push(() => window.clearInterval(timer));
    const track = canvas.captureStream(10).getVideoTracks()[0];
    if (track === undefined) throw new Error('合成视频源没产出轨道');
    return track;
  }

  /** stop 停掉合成源的定时器与音频上下文。 */
  stop(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}

/** browserMediaSource 是真设备源，勾掉「合成」时用它。 */
export const browserMediaSource: MediaSource = {
  getStream: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
};
