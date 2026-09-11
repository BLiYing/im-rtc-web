import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorCode, RtcError } from '@im-rtc/call-engine';

import { CallProvider } from '../src/CallProvider.js';
import { CallOverlay } from '../src/components/CallOverlay.js';
import { initialCallView, reduceCallView, showsIncomingPage } from '../src/state/callView.js';
import type { PermissionQuery, PermissionStatus } from '../src/state/permissions.js';
import { shouldPreviewWhileRinging } from '../src/state/permissions.js';
import { FakeEngine, asEngine } from './fakeEngine.js';

/**
 * 来电页（草图 §03-F / §04-I，设计 v3.7）：
 * - 点横幅本体展开成来电页；横幅上的按钮自己吃掉点击；`bannerFirst={false}` 直接进来电页；
 * - 来电页上**只在早就授过权时**起本端预览，响铃中不弹任何权限框；预览失败只记日志、不打成「无权限」；
 * - 群来电的来电页是九宫格。
 */

interface SetupOptions {
  readonly status?: PermissionStatus;
  readonly bannerFirst?: boolean;
  readonly query?: PermissionQuery;
}

function setup({ status = 'granted', bannerFirst, query }: SetupOptions = {}): FakeEngine {
  const engine = new FakeEngine();
  const q: PermissionQuery = query ?? (async () => status);
  render(
    <CallProvider engine={asEngine(engine)} endedHoldMs={0} permissionQuery={q}
      {...(bannerFirst === undefined ? {} : { bannerFirst })}>
      <CallOverlay />
    </CallProvider>,
  );
  return engine;
}

function ring(engine: FakeEngine, isGroup = false, mediaType: 'audio' | 'video' = 'video'): void {
  act(() => {
    engine.emit('callReceived', {
      callId: 'c-1', caller: 'alice', calleeIds: isGroup ? ['me', 'bob'] : [], mediaType, isGroup,
    });
  });
}

/** flush 把 effect 里那条 await 链放完。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function previews(engine: FakeEngine): number {
  return engine.calls.filter((c) => c === 'startLocalPreview').length;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('横幅 → 来电页', () => {
  it('点横幅本体展开成来电页，横幅消失', async () => {
    const engine = setup();
    ring(engine);
    fireEvent.click(screen.getByTestId('incoming-call'));
    await flush();
    expect(screen.getByTestId('incoming-page')).toBeTruthy();
    expect(screen.queryByTestId('incoming-call')).toBeNull();
  });

  it('点横幅上的按钮不会顺带展开', async () => {
    const engine = setup();
    ring(engine);
    fireEvent.click(screen.getByTestId('incoming-toggle-camera'));
    fireEvent.click(screen.getByTestId('reject-call'));
    await flush();
    expect(engine.calls).toContain('reject');
    expect(screen.queryByTestId('incoming-page')).toBeNull();
  });

  it('bannerFirst={false}：来电直接进来电页；标题栏不给小窗键，底部是摄像头 / 拒绝 / 接听', async () => {
    const engine = setup({ bannerFirst: false });
    ring(engine);
    await flush();
    expect(screen.getByTestId('incoming-page')).toBeTruthy();
    expect(screen.queryByTestId('minimize')).toBeNull();
    expect(screen.getByTestId('incoming-controls')).toBeTruthy();
    expect(screen.getByTestId('incoming-toggle-camera')).toBeTruthy();
    expect(screen.getByText('邀请你视频通话')).toBeTruthy();
  });

  it('来电页上点接听走的是同一条接听路径', async () => {
    const engine = setup({ bannerFirst: false });
    ring(engine);
    await flush();
    fireEvent.click(screen.getByTestId('accept-call'));
    await flush();
    expect(engine.calls).toContain('accept');
  });

  it('群来电的来电页是九宫格', async () => {
    const engine = setup({ bannerFirst: false });
    ring(engine, true);
    await flush();
    expect(screen.getByTestId('incoming-page').getAttribute('data-layout')).toBe('grid');
    expect(screen.getByTestId('grid-stage')).toBeTruthy();
  });

  it('展开标志只属于这一通：挂掉再来一通，照样先出横幅', async () => {
    const engine = setup();
    ring(engine);
    fireEvent.click(screen.getByTestId('incoming-call'));
    await flush();
    act(() => {
      engine.emit('callEnd', { callId: 'c-1', reason: 'cancel', durationSec: 0, endedBy: 'alice' });
    });
    ring(engine);
    await flush();
    expect(screen.getByTestId('incoming-call')).toBeTruthy();
    expect(screen.queryByTestId('incoming-page')).toBeNull();
  });
});

describe('来电页的本端预览', () => {
  it('已授权 + 1v1 视频：来电页上起预览、显示本端小窗，不探权限', async () => {
    const engine = setup({ bannerFirst: false });
    ring(engine);
    await flush();
    expect(previews(engine)).toBe(1);
    expect(screen.getByLabelText('本端画面')).toBeTruthy();
    expect(engine.calls).not.toContain('probeCam');
  });

  it('横幅上不起预览，点开之后才起', async () => {
    const engine = setup();
    ring(engine);
    await flush();
    expect(previews(engine)).toBe(0);
    fireEvent.click(screen.getByTestId('incoming-call'));
    await flush();
    expect(previews(engine)).toBe(1);
  });

  it.each<PermissionStatus>(['prompt', 'unknown', 'denied'])('权限是 %s：不起预览，也不去探（探就是弹框）', async (status) => {
    const engine = setup({ status, bannerFirst: false });
    ring(engine);
    await flush();
    expect(previews(engine)).toBe(0);
    expect(engine.calls).not.toContain('probeCam');
  });

  it('语音来电不起预览', async () => {
    const engine = setup({ bannerFirst: false });
    ring(engine, false, 'audio');
    await flush();
    expect(previews(engine)).toBe(0);
  });

  it('预览失败只记日志：摄像头按钮不打成「无权限」，仍是开着——接听那一下还会再申请', async () => {
    const engine = setup({ bannerFirst: false });
    engine.previewError = new RtcError(ErrorCode.devicePermissionDenied);
    ring(engine);
    await flush();
    const button = screen.getByTestId('incoming-toggle-camera');
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('无权限')).toBeNull();
  });

  it('查权限还没回来通话就结束了：不再起预览', async () => {
    let answer: (s: PermissionStatus) => void = () => undefined;
    const query: PermissionQuery = () => new Promise((resolve) => { answer = resolve; });
    const engine = setup({ bannerFirst: false, query });
    ring(engine);
    await flush();
    act(() => {
      engine.emit('callEnd', { callId: 'c-1', reason: 'cancel', durationSec: 0, endedBy: 'alice' });
    });
    answer('granted');
    await flush();
    expect(previews(engine)).toBe(0);
  });

  it('群视频来电默认关着摄像头：来电页上点开，已授权才起预览（只起一次）', async () => {
    const engine = setup({ bannerFirst: false });
    ring(engine, true);
    await flush();
    expect(previews(engine)).toBe(0);
    fireEvent.click(screen.getByTestId('incoming-toggle-camera'));
    await flush();
    expect(previews(engine)).toBe(1);
  });
});

/*
  来电页上关摄像头 = 真的停采集（交互稿 §01 v3.7）。
  只熄按钮的话，开过又关掉的摄像头指示灯要一直亮到通话结束。
*/
describe('来电页上关摄像头：真的停采集', () => {
  function stops(engine: FakeEngine): number {
    return engine.calls.filter((c) => c === 'stopLocalPreview').length;
  }

  it('预览起好后关掉：停采集、本端小窗收起；再打开重新起预览', async () => {
    const engine = setup({ bannerFirst: false });
    ring(engine);
    await flush();
    expect(screen.getByLabelText('本端画面')).toBeTruthy();

    fireEvent.click(screen.getByTestId('incoming-toggle-camera'));
    await flush();
    expect(stops(engine)).toBe(1);
    expect(screen.queryByLabelText('本端画面')).toBeNull();

    fireEvent.click(screen.getByTestId('incoming-toggle-camera'));
    await flush();
    expect(previews(engine)).toBe(2);
    expect(screen.getByLabelText('本端画面')).toBeTruthy();
  });

  it('预览还在起时关掉：起完回来不写 cid，本端小窗不出来', async () => {
    const engine = setup({ bannerFirst: false });
    let release: () => void = () => undefined;
    engine.previewHold = new Promise((resolve) => { release = resolve; });
    ring(engine);
    await flush();
    expect(previews(engine)).toBe(1);

    fireEvent.click(screen.getByTestId('incoming-toggle-camera'));
    await flush();
    release();
    await flush();
    expect(stops(engine)).toBe(1);
    expect(screen.queryByLabelText('本端画面')).toBeNull();
  });

  it('还在起时关掉又打开：重新起一次（让还在等的停止作罢），本端小窗照常出来', async () => {
    const engine = setup({ bannerFirst: false });
    let release: () => void = () => undefined;
    engine.previewHold = new Promise((resolve) => { release = resolve; });
    ring(engine);
    await flush();

    fireEvent.click(screen.getByTestId('incoming-toggle-camera'));
    await flush();
    fireEvent.click(screen.getByTestId('incoming-toggle-camera'));
    await flush();
    release();
    await flush();
    expect(previews(engine)).toBe(2);
    expect(screen.getByLabelText('本端画面')).toBeTruthy();
  });

  it('关着摄像头接听：只问麦克风、只推麦克风，进房时再停一次预览兜底', async () => {
    const engine = setup({ bannerFirst: false });
    ring(engine);
    await flush();
    fireEvent.click(screen.getByTestId('incoming-toggle-camera'));
    await flush();
    fireEvent.click(screen.getByTestId('accept-call'));
    await flush();
    act(() => {
      engine.emit('callBegin', { callId: 'c-1', roomId: 'r-1', mediaType: 'video', isGroup: false, role: 'callee' });
      engine.emit('roomJoined', { roomId: 'r-1' });
    });
    await flush();
    expect(engine.calls).not.toContain('probeCam');
    expect(engine.calls).toContain('publishMic');
    expect(engine.calls).not.toContain('publishCam');
    expect(engine.calls.slice(engine.calls.indexOf('publishMic'))).toContain('stopLocalPreview');
  });
});

describe('纯函数', () => {
  it('expandIncoming 只在响铃时生效', () => {
    expect(reduceCallView(initialCallView, { type: 'expandIncoming' }).isBannerExpanded).toBe(false);
    const ringing = { ...initialCallView, phase: 'incoming' as const };
    expect(reduceCallView(ringing, { type: 'expandIncoming' }).isBannerExpanded).toBe(true);
  });

  it('showsIncomingPage：bannerFirst 关掉或点开过才是来电页', () => {
    const ringing = { ...initialCallView, phase: 'incoming' as const };
    expect(showsIncomingPage(ringing, true)).toBe(false);
    expect(showsIncomingPage(ringing, false)).toBe(true);
    expect(showsIncomingPage({ ...ringing, isBannerExpanded: true }, true)).toBe(true);
    expect(showsIncomingPage({ ...initialCallView, isBannerExpanded: true }, false)).toBe(false);
  });

  it('shouldPreviewWhileRinging 与 iOS 同一条判据', () => {
    expect(shouldPreviewWhileRinging('video', true, false, 'granted')).toBe(true);
    expect(shouldPreviewWhileRinging('video', true, false, 'prompt')).toBe(false);
    expect(shouldPreviewWhileRinging('video', true, false, 'unknown')).toBe(false);
    expect(shouldPreviewWhileRinging('video', false, false, 'granted')).toBe(false);
    expect(shouldPreviewWhileRinging('video', true, true, 'granted')).toBe(false);
    expect(shouldPreviewWhileRinging('audio', true, false, 'granted')).toBe(false);
  });
});
