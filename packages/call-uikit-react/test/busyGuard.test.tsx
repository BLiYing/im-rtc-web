import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CallProvider } from '../src/CallProvider.js';
import { CallOverlay } from '../src/components/CallOverlay.js';
import type { CallViewState } from '../src/state/viewTypes.js';
import { busyNotice, newCallAllowed } from '../src/state/busy.js';
import { useCall } from '../src/useCall.js';
import { FakeEngine, asEngine } from './fakeEngine.js';

/**
 * 「已在通话中又开始另一场」的守门（真机事故 2026-09-19：1v1 收成小窗后去发起群通话，界面被换成另一通、没有提示）。
 * 判据缺失时 `placeCall` 会先把界面状态整个换掉，再被 engine 拒成 2005。
 */
function Entries(): ReactNode {
  const { actions } = useCall();
  return (
    <>
      <button type="button" data-testid="place-group" onClick={() => void actions.placeCall(['carol'], 'video', { isGroup: true, chatGroupId: 'g1' })}>群</button>
      <button type="button" data-testid="join-meeting" onClick={() => void actions.joinMeeting('room-1', 'tok')}>会议</button>
    </>
  );
}

function setup(engine: FakeEngine): void {
  render(
    <CallProvider engine={asEngine(engine)} endedHoldMs={5000}>
      <Entries />
      <CallOverlay />
    </CallProvider>,
  );
}

function connectOneToOne(engine: FakeEngine): void {
  act(() => {
    engine.emit('callBegin', {
      callId: 'c-1', roomId: 'r-1', mediaType: 'audio', isGroup: false, role: 'callee',
      caller: 'bob', chatGroupId: '', userData: '',
    });
    engine.emit('roomJoined', { roomId: 'r-1' });
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('newCallAllowed：只有空闲或停在结束画面才能开始新的一场', () => {
  it('逐 phase 的结论', () => {
    const phases: CallViewState['phase'][] = ['idle', 'incoming', 'outgoing', 'connecting', 'active', 'ended'];
    for (const phase of phases) {
      expect(newCallAllowed(phase), phase).toBe(phase === 'idle' || phase === 'ended');
    }
  });
});

describe('通话中再发起 / 进会议', () => {
  it('placeCall：不发 call 帧、不换界面，只弹提示', async () => {
    const engine = new FakeEngine();
    setup(engine);
    connectOneToOne(engine);
    const before = screen.getByTestId('active-call').textContent;
    fireEvent.click(screen.getByTestId('place-group'));
    await flush();
    expect(engine.calls.some((c) => c.startsWith('call:'))).toBe(false);
    expect(screen.getByTestId('active-call').textContent).toBe(before);
    expect(document.body.textContent).toContain(busyNotice());
  });

  it('joinMeeting：同样不动当前通话、不进房', async () => {
    const engine = new FakeEngine();
    setup(engine);
    connectOneToOne(engine);
    fireEvent.click(screen.getByTestId('join-meeting'));
    await flush();
    expect(engine.calls.some((c) => c.startsWith('join:'))).toBe(false);
    expect(document.body.textContent).toContain(busyNotice());
  });

  it('空闲时照常发起（守门不能误伤）', async () => {
    const engine = new FakeEngine();
    setup(engine);
    fireEvent.click(screen.getByTestId('place-group'));
    await flush();
    expect(engine.calls.some((c) => c.startsWith('call:carol'))).toBe(true);
    expect(document.body.textContent).not.toContain(busyNotice());
  });
});
