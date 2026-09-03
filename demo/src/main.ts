import { CallEngine, WebRTCAdapter, setLogLevel } from '@im-rtc/call-engine';
import type { EngineEventName } from '@im-rtc/call-engine';

import { createMeetingRoom, demoLogin, fetchRoomToken } from './api.js';
import { SyntheticMediaSource, browserMediaSource } from './syntheticMedia.js';

/**
 * Demo 的「自画 UI」模式。
 *
 * **整页没有引 uikit**：所有界面都靠 `engine.on(...)` 的公开事件画出来。
 * 这就是「只引 SDK 自画 UI」那条集成路线的完整示范——
 * 宿主能拿到的信息与 uikit 完全一致。
 */

setLogLevel('debug');

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
    if (found === null) throw new Error(`找不到 #${id}`);
  return found as T;
};

const ui = {
  server: el<HTMLInputElement>('server'),
  username: el<HTMLInputElement>('username'),
  synthetic: el<HTMLInputElement>('synthetic'),
  login: el<HTMLButtonElement>('login'),
  room: el<HTMLInputElement>('room'),
  join: el<HTMLButtonElement>('join'),
  leave: el<HTMLButtonElement>('leave'),
  toggleMic: el<HTMLButtonElement>('toggleMic'),
  toggleCam: el<HTMLButtonElement>('toggleCam'),
  videos: el<HTMLDivElement>('videos'),
  events: el<HTMLOListElement>('events'),
};

let engine: CallEngine | null = null;
let token = '';
let synthetic: SyntheticMediaSource | null = null;
let micCid = '';
let camCid = '';
let micMuted = false;
let camMuted = false;
const videoEls = new Map<string, HTMLVideoElement>();

/** logEvent 把公开事件打到页面上——这一页的「日志」就是产品的事件表。 */
function logEvent(name: string, payload: unknown): void {
  const item = document.createElement('li');
  item.innerHTML = `<b>${name}</b> <span>${JSON.stringify(payload)}</span>`;
  ui.events.prepend(item);
  while (ui.events.children.length > 80) ui.events.lastElementChild?.remove();
}

/** attachVideo 把一条轨道挂到页面上。列表 key 用 trackId（稳定业务 id）。 */
function attachVideo(trackId: string, track: MediaStreamTrack, label: string): void {
  let video = videoEls.get(trackId);
  if (video === undefined) {
    const box = document.createElement('div');
    box.className = 'tile';
    video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    const caption = document.createElement('span');
    caption.textContent = label;
    box.append(video, caption);
    ui.videos.append(box);
    videoEls.set(trackId, video);
  }
  const stream = (video.srcObject as MediaStream | null) ?? new MediaStream();
  stream.addTrack(track);
  video.srcObject = stream;
  if (label.startsWith('本地')) video.muted = true; // 不然自己听自己会啸叫
}

function bindEvents(target: CallEngine): void {
  const names: EngineEventName[] = [
    'connected',
    'disconnected',
    'kickedOut',
    'error',
    'roomJoined',
    'roomLeft',
    'roomClosed',
    'userEnter',
    'userLeave',
    'userAudioAvailable',
    'userVideoAvailable',
    'activeSpeakers',
    'networkQuality',
    'firstVideoFrame',
  ];
  for (const name of names) {
    target.on(name, (payload) => logEvent(name, payload));
  }
  target.on('remoteTrack', ({ trackId, track }) => {
    logEvent('remoteTrack', { trackId, kind: track.kind });
    attachVideo(trackId, track, `远端 ${trackId.slice(0, 10)}`);
  });
}

ui.login.addEventListener('click', () => {
  void (async () => {
    try {
      const server = ui.server.value.trim();
      token = await demoLogin(server, ui.username.value.trim());

      synthetic = ui.synthetic.checked ? new SyntheticMediaSource(ui.username.value.trim()) : null;
      const adapter = new WebRTCAdapter(synthetic ?? browserMediaSource);
      engine = new CallEngine({
        url: `${server.replace(/^http/, 'ws')}/v1/ws`,
        deviceId: `demo-${ui.username.value.trim()}`,
        media: adapter,
      });
      bindEvents(engine);

      const hello = await engine.login(token);
      logEvent('login.ok', { uid: hello.uid, sessionId: hello.sessionId });
      ui.join.disabled = false;
      ui.login.disabled = true;
    } catch (err) {
      logEvent('login.failed', String(err));
    }
  })();
});

ui.join.addEventListener('click', () => {
  void (async () => {
    const current = engine;
    if (current === null) return;
    try {
      const server = ui.server.value.trim();
      const roomId = ui.room.value.trim() || (await createMeetingRoom(server, token));
      ui.room.value = roomId;

      const roomToken = await fetchRoomToken(server, token, roomId, `demo-${ui.username.value.trim()}`);
      await current.joinRoom(roomId, roomToken);

      micCid = await current.publishMicrophone();
      camCid = await current.publishCamera(false);
      logEvent('published', { micCid, camCid });

      const local = current.localTrack(camCid);
      if (local !== undefined) attachVideo(camCid, local, '本地');

      ui.join.disabled = true;
      ui.leave.disabled = false;
      ui.toggleMic.disabled = false;
      ui.toggleCam.disabled = false;
    } catch (err) {
      logEvent('join.failed', String(err));
    }
  })();
});

/** 开关麦克风/摄像头。走 mute：轨道与协商都保留，只是停止发包。 */
ui.toggleMic.addEventListener('click', () => {
  void (async () => {
    micMuted = !micMuted;
    await engine?.setMuted(micCid, micMuted);
    ui.toggleMic.textContent = micMuted ? '开麦克风' : '关麦克风';
    logEvent('local.mute', { kind: 'audio', muted: micMuted });
  })();
});

ui.toggleCam.addEventListener('click', () => {
  void (async () => {
    camMuted = !camMuted;
    await engine?.setMuted(camCid, camMuted);
    ui.toggleCam.textContent = camMuted ? '开摄像头' : '关摄像头';
    logEvent('local.mute', { kind: 'video', muted: camMuted });
  })();
});

ui.leave.addEventListener('click', () => {
  void (async () => {
    await engine?.leaveRoom();
    engine?.logout();
    synthetic?.stop();
    for (const video of videoEls.values()) video.remove();
    videoEls.clear();
    ui.videos.replaceChildren();
    ui.join.disabled = false;
    ui.leave.disabled = true;
    ui.toggleMic.disabled = true;
    ui.toggleCam.disabled = true;
    ui.login.disabled = false;
  })();
});
