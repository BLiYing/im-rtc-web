import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CallProvider } from '../src/CallProvider.js';
import { CallOverlay } from '../src/components/CallOverlay.js';
import { FakeEngine, asEngine } from './fakeEngine.js';

/**
 * 红键看门狗接进界面之后的两条路（jsdom，CONVENTIONS §9）：
 * · 按下 → 没人应 → 到点本地收场，**并让 engine 也离场**（`forceEnd`）；
 * · 按下 → 结束事件按时回来 → 不收场、不调 `forceEnd`。
 */

const WATCHDOG_MS = 30;

function setup(): FakeEngine {
  const engine = new FakeEngine();
  render(
    <CallProvider engine={asEngine(engine)} endedHoldMs={0} endWatchdogMs={WATCHDOG_MS}>
      <CallOverlay />
    </CallProvider>,
  );
  return engine;
}

function connect(engine: FakeEngine): void {
  act(() => {
    engine.emit('callBegin', { callId: 'c-1', roomId: 'r-1', mediaType: 'video', isGroup: true, role: 'callee' });
    engine.emit('roomJoined', { roomId: 'r-1' });
  });
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('红键看门狗', () => {
  it('按下挂断没人应：到点本地收场，并调 engine.forceEnd()', async () => {
    const engine = setup();
    connect(engine);

    fireEvent.click(screen.getByTestId('end-call'));
    await wait(WATCHDOG_MS * 3);

    expect(engine.calls).toContain('hangup');
    expect(engine.calls.filter((call) => call === 'forceEnd')).toHaveLength(1);
    expect(screen.queryByTestId('end-call')).toBeNull(); // 通话中的控制条已经收掉了
  });

  it('按下挂断、结束事件按时回来：不收场、不调 forceEnd', async () => {
    const engine = setup();
    connect(engine);

    fireEvent.click(screen.getByTestId('end-call'));
    act(() => {
      engine.emit('callEnd', { callId: 'c-1', reason: 'hangup', durationSec: 3, endedBy: 'me' });
    });
    await wait(WATCHDOG_MS * 3);

    expect(engine.calls).toContain('hangup');
    expect(engine.calls).not.toContain('forceEnd');
  });
});
