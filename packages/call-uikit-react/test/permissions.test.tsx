import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorCode, RtcError } from '@im-rtc/call-engine';

import { CallProvider } from '../src/CallProvider.js';
import { CallOverlay } from '../src/components/CallOverlay.js';
import type { PermissionQuery, PermissionStatus } from '../src/state/permissions.js';
import { blockedCopy, classifyProbeError, devicesFor, needsExplanation } from '../src/state/permissions.js';
import { useCall } from '../src/useCall.js';
import { FakeEngine, asEngine } from './fakeEngine.js';

/**
 * 权限申请的三段式（交互稿 §01–§02）：前置说明卡 → 系统框 → 结果分支。
 *
 * 权限状态查询是注入的（jsdom 没有 `navigator.permissions`），系统框那一步由
 * FakeEngine 的 `probeMicrophone` / `startLocalPreview` 代替——它们抛 2001 就是「用户点了不允许」。
 */

/** Dial 是测试用的宿主拨号键。 */
function Dial({ mediaType }: { readonly mediaType: 'audio' | 'video' }): ReactNode {
  const { actions } = useCall();
  return (
    <button type="button" data-testid="dial" onClick={() => void actions.placeCall(['bob'], mediaType)}>
      拨
    </button>
  );
}

function setup(status: PermissionStatus, mediaType: 'audio' | 'video' = 'audio'): FakeEngine {
  const engine = new FakeEngine();
  const query: PermissionQuery = async () => status;
  render(
    <CallProvider engine={asEngine(engine)} endedHoldMs={0} permissionQuery={query}>
      <Dial mediaType={mediaType} />
      <CallOverlay />
    </CallProvider>,
  );
  return engine;
}

/** flush 把链上的几个 await 放完。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('决策逻辑（纯函数）', () => {
  it('语音只要麦克风；视频先麦克风再摄像头；关着摄像头接听只要麦克风', () => {
    expect(devicesFor('audio', true)).toEqual(['microphone']);
    expect(devicesFor('video', true)).toEqual(['microphone', 'camera']);
    expect(devicesFor('video', false)).toEqual(['microphone']);
  });

  it('只有「首次」才出说明卡', () => {
    expect(needsExplanation('prompt')).toBe(true);
    expect(needsExplanation('granted')).toBe(false);
    expect(needsExplanation('denied')).toBe(false);
    // Safari 查不到 → 直接探，不出卡。
    expect(needsExplanation('unknown')).toBe(false);
  });

  it('engine 的两个本地码分别归成被拒 / 无设备，别的错误不吞', () => {
    expect(classifyProbeError(new RtcError(ErrorCode.devicePermissionDenied))).toBe('denied');
    expect(classifyProbeError(new RtcError(ErrorCode.deviceNotFound))).toBe('no-device');
    expect(classifyProbeError(new RtcError(ErrorCode.invalidState))).toBeNull();
    expect(classifyProbeError(new Error('x'))).toBeNull();
  });

  it('文案：麦克风走不下去，摄像头降级继续', () => {
    expect(blockedCopy('microphone', 'denied').title).toContain('无法通话');
    expect(blockedCopy('camera', 'denied').title).toContain('已用语音继续通话');
  });
});

describe('拨出前的权限门', () => {
  it('已授权：一个框都不出，直接探完就拨', async () => {
    const engine = setup('granted');
    fireEvent.click(screen.getByTestId('dial'));
    await flush();
    expect(screen.queryByTestId('prompt-explain')).toBeNull();
    expect(engine.calls).toEqual(['probeMic', 'call:bob:audio']);
  });

  it('首次：先出说明卡，点「好」才探、才拨', async () => {
    const engine = setup('prompt');
    fireEvent.click(screen.getByTestId('dial'));
    await flush();
    // 说明卡出来了，invite 还没发——系统框只有一次机会，说明卡是为它做铺垫。
    expect(screen.getByTestId('prompt-explain').textContent).toContain('需要用到麦克风');
    expect(engine.calls).not.toContain('call:bob:audio');

    fireEvent.click(screen.getByTestId('prompt-explain-primary'));
    await flush();
    expect(engine.calls).toEqual(['probeMic', 'call:bob:audio']);
  });

  it('说明卡上点「取消」= 放弃这次通话，不留副作用', async () => {
    const engine = setup('prompt');
    fireEvent.click(screen.getByTestId('dial'));
    await flush();
    fireEvent.click(screen.getByTestId('prompt-explain-secondary'));
    await flush();
    expect(engine.calls).toEqual([]);
    expect(screen.queryByTestId('active-call')).toBeNull();
  });

  it('麦克风被拒：出「无法通话」卡，不发 invite，界面收起', async () => {
    const engine = setup('unknown');
    engine.probeError = new RtcError(ErrorCode.devicePermissionDenied);
    fireEvent.click(screen.getByTestId('dial'));
    await flush();
    expect(screen.getByTestId('prompt-blocked').textContent).toContain('没有麦克风权限，无法通话');
    expect(engine.calls).toEqual(['probeMic']);

    fireEvent.click(screen.getByTestId('prompt-blocked-primary'));
    await flush();
    expect(screen.queryByTestId('active-call')).toBeNull();
    expect(engine.calls).not.toContain('call:bob:audio');
  });

  it('摄像头被拒：降级为语音继续，invite 照发，摄像头按钮变「无权限」', async () => {
    const engine = setup('unknown', 'video');
    engine.previewError = new RtcError(ErrorCode.devicePermissionDenied);
    fireEvent.click(screen.getByTestId('dial'));
    await flush();
    expect(screen.getByTestId('prompt-blocked').textContent).toContain('已用语音继续通话');
    fireEvent.click(screen.getByTestId('prompt-blocked-primary'));
    await flush();

    expect(engine.calls).toContain('call:bob:video');
    const camera = screen.getByTestId('toggle-camera');
    expect(camera.getAttribute('aria-disabled')).toBe('true');
    expect(camera.textContent).toContain('无权限');

    // 接通后只推麦克风，不去开摄像头。
    act(() => {
      engine.emit('callBegin', { callId: 'c-1', roomId: 'r-1', mediaType: 'video', isGroup: false, role: 'caller' });
      engine.emit('roomJoined', { roomId: 'r-1' });
    });
    await flush();
    expect(engine.calls).toContain('publishMic');
    expect(engine.calls).not.toContain('publishCam');
  });
});
