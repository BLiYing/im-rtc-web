import { describe, expect, it } from 'vitest';

import { CallEngine } from '../src/engine.js';
import { NullMedia } from './nullMedia.js';

/**
 * `destroy()` 之后**每一个**公开方法归哪一类，逐条钉住（CallEngine.destroy 的文档注释）。
 *
 * - THROWS：发起类与本地设备类，reject / throw `2005 invalid_state`——与平时失败同一个出口（结果回给调用方）。
 * - SAFE：读、清理、提示类，照常返回、不抛——宿主卸载时无脑清理，不该因先后顺序报错。
 *
 * 归类规则是四端共用的（server `docs/design/ACTION_RESULT_DESIGN.md` §3 与 R6），逐端状态在
 * server `docs/CLIENT_PARITY.md`。
 *
 * 最后一条用例扫 `CallEngine.prototype`：**新增公开方法不归进这张表就红**，
 * 逼着加方法的人想清楚它归哪类（current_task「已知坑」那条的硬闸）。
 */

type Call = (engine: CallEngine) => unknown;

const THROWS: Readonly<Record<string, Call>> = {
  login: (e) => e.login('token'),
  call: (e) => e.call(['bob'], 'video'),
  joinCall: (e) => e.joinCall('c-1'),
  accept: (e) => e.accept(),
  reject: (e) => e.reject(),
  cancel: (e) => e.cancel(),
  hangup: (e) => e.hangup(),
  inviteMore: (e) => e.inviteMore(['carol']),
  probeMicrophone: (e) => e.probeMicrophone(),
  probeCamera: (e) => e.probeCamera(),
  joinRoom: (e) => e.joinRoom('room-1', 'room-token'),
  leaveRoom: (e) => e.leaveRoom(),
  publishMicrophone: (e) => e.publishMicrophone(),
  openMicrophone: (e) => e.openMicrophone(),
  startLocalPreview: (e) => e.startLocalPreview(),
  publishCamera: (e) => e.publishCamera(),
  openCamera: (e) => e.openCamera(),
  setMuted: (e) => e.setMuted('mic-1', true),
};

const SAFE: Readonly<Record<string, Call>> = {
  on: (e) => e.on('error', () => undefined),
  uid: (e) => e.uid,
  state: (e) => e.state,
  updateToken: (e) => e.updateToken('token2'),
  setAppForeground: (e) => e.setAppForeground(true),
  notifyNetworkChanged: (e) => e.notifyNetworkChanged(),
  logout: (e) => e.logout(),
  destroy: (e) => e.destroy(),
  forceEnd: (e) => e.forceEnd(),
  closeMicrophone: (e) => e.closeMicrophone(),
  closeCamera: (e) => e.closeCamera(),
  // 提示类（ACTION_RESULT_DESIGN D3）：没有结果，销毁后同清理类一样是空操作。
  setRemoteLayer: (e) => e.setRemoteLayer('bob', 'l'),
  stopLocalPreview: (e) => e.stopLocalPreview(),
  localTrack: (e) => e.localTrack('mic-1'),
  attachView: (e) => {
    e.attachView('bob', null);
    e.attachView('bob', {} as HTMLVideoElement);
  },
  attachLocalView: (e) => {
    e.attachLocalView('cam-1', null);
    e.attachLocalView('cam-1', {} as HTMLVideoElement);
  },
};

/** 运行期看得见的私有方法（TS 的 private 只在编译期）。 */
const INTERNAL = new Set(['constructor', 'assertNotDestroyed', 'act', 'mediaApi', 'wiring']);

/** StickyMedia 的 close() 不清发布记账：宿主自带适配器时完全可能这样，close* 不能因此变成抛错。 */
class StickyMedia extends NullMedia {
  override close(): void {}
}

function destroyed(media = new NullMedia()): CallEngine {
  const engine = new CallEngine({ url: 'ws://test/v1/ws', deviceId: 'd1', media });
  engine.destroy();
  return engine;
}

describe('destroy 之后的方法归类', () => {
  it.each(Object.entries(THROWS))('%s 抛 2005', async (_name, call) => {
    const engine = destroyed();
    await expect(Promise.resolve().then(() => call(engine))).rejects.toMatchObject({ code: 2005 });
  });

  it.each(Object.entries(SAFE))('%s 不抛', async (_name, call) => {
    const engine = destroyed();
    // 同步抛或 reject 都会让这一行失败。
    await Promise.resolve().then(() => call(engine));
  });

  it('close* 不看适配器记账：发布记账没被 close 清掉也是空操作', async () => {
    const media = new StickyMedia();
    const engine = new CallEngine({ url: 'ws://test/v1/ws', deviceId: 'd1', media });
    await media.acquireMicrophone();
    await media.acquireCamera();
    engine.destroy();

    await expect(engine.closeMicrophone()).resolves.toBeUndefined();
    await expect(engine.closeCamera()).resolves.toBeUndefined();
  });

  it('CallEngine 的每个公开方法都归了类', () => {
    const proto = CallEngine.prototype as unknown as Record<string, unknown>;
    const names = Object.getOwnPropertyNames(proto).filter((n) => !INTERNAL.has(n));
    const classified = new Set([...Object.keys(THROWS), ...Object.keys(SAFE)]);
    expect(names.filter((n) => !classified.has(n))).toEqual([]);
    expect([...classified].filter((n) => !names.includes(n))).toEqual([]);
  });
});
