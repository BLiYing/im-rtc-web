import { CallEngine, WebRTCAdapter, setLogLevel } from '@im-rtc/call-engine';
import type { EngineEventName } from '@im-rtc/call-engine';

import { createMeetingRoom, demoLogin, fetchRoomToken } from './api.js';
import { guardConnection } from './connectionGuard.js';
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
  create: el<HTMLButtonElement>('create'),
  conn: el<HTMLSpanElement>('conn'),
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

      /*
        换票与「被踢就回登录态」这套处置**是宿主的活**（协议 §1.5：4401 = 换新 token
        再来，而票从宿主的账号体系来）。engine 只留 `updateToken` 这个口子，
        来票的那一步永远在这里。
      */
      guardConnection(engine, () => demoLogin(server, ui.username.value.trim()), {
        onPhase: (_phase, detail) => {
          ui.conn.textContent = detail;
        },
        onDead: (reason) => {
          engine?.logout();
          engine = null;
          ui.conn.textContent = reason;
          resetToLogin();
        },
      });

      const hello = await engine.login(token);
      logEvent('login.ok', { uid: hello.uid, sessionId: hello.sessionId });
      ui.conn.textContent = '● 已连接';
      ui.join.disabled = false;
      ui.create.disabled = false;
      ui.login.disabled = true;
    } catch (err) {
      logEvent('login.failed', String(err));
    }
  })();
});

/*
  **「新建」与「加入」分成两个按钮**，不再由一个按钮按输入框空不空自己猜。

  猜错的代价实测撞到过：会议房**空了就销毁**（最后一个人离开即关），
  而输入框里还留着刚离开的那个房间号——想新建一个，点下去却是去加入一个
  已经不存在的房间。房间号留在框里是有用的（要发给另一个标签页），
  所以留着框、把动作拆开，比清空框更对。
*/
async function enterRoom(roomId: string): Promise<void> {
  const current = engine;
  if (current === null) return;
  const server = ui.server.value.trim();
  ui.room.value = roomId;

  const roomToken = await fetchRoomToken(server, token, roomId, `demo-${ui.username.value.trim()}`);
  await current.joinRoom(roomId, roomToken);

  micCid = await current.publishMicrophone();
  camCid = await current.publishCamera(false);
  logEvent('published', { micCid, camCid });

  const local = current.localTrack(camCid);
  if (local !== undefined) attachVideo(camCid, local, '本地');

  ui.join.disabled = true;
  ui.create.disabled = true;
  ui.leave.disabled = false;
  ui.toggleMic.disabled = false;
  ui.toggleCam.disabled = false;
}

ui.join.addEventListener('click', () => {
  void enterRoom(ui.room.value.trim()).catch((err: unknown) =>
    logEvent('join.failed', String(err)));
});

ui.create.addEventListener('click', () => {
  void (async () => {
    ui.room.value = await createMeetingRoom(ui.server.value.trim(), token);
    await enterRoom(ui.room.value);
  })().catch((err: unknown) => logEvent('create.failed', String(err)));
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

/** resetToLogin 把界面收回未登录的样子。被「离房」与「被踢」共用。 */
function resetToLogin(): void {
  synthetic?.stop();
  for (const video of videoEls.values()) video.remove();
  videoEls.clear();
  ui.videos.replaceChildren();
  ui.join.disabled = true;
  ui.create.disabled = true;
  ui.leave.disabled = true;
  ui.toggleMic.disabled = true;
  ui.toggleCam.disabled = true;
  ui.login.disabled = false;
}

ui.leave.addEventListener('click', () => {
  void (async () => {
    await engine?.leaveRoom();
    engine?.logout();
    engine = null;
    resetToLogin();
  })();
});
