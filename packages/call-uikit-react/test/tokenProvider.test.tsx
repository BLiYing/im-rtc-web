import { ErrorCode, RtcError } from 'im-rtc-call-engine';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CallProvider } from '../src/CallProvider.js';
import { CallOverlay } from '../src/components/CallOverlay.js';
import type { KitToken, TokenProvider } from '../src/session/kitSession.js';
import { t } from '../src/i18n/index.js';
import { useCall } from '../src/useCall.js';
import { FakeEngine, asEngine } from './fakeEngine.js';

/**
 * `<CallProvider tokenProvider>`（server `docs/design/KIT_TOKEN_PROVIDER_DESIGN.md` §6）：
 * 登录归 Kit；拨号前没登上先补一次，补不上就收起拨出页、说人话，不发 invite。
 */
function Entries(): ReactNode {
  const { actions } = useCall();
  return (
    <button type="button" data-testid="place" onClick={() => void actions.placeCall(['bob'], 'audio')}>拨</button>
  );
}

function setup(engine: FakeEngine, tokenProvider?: TokenProvider): () => void {
  const view = render(
    <CallProvider engine={asEngine(engine)} {...(tokenProvider === undefined ? {} : { tokenProvider })}>
      <Entries />
      <CallOverlay />
    </CallProvider>,
  );
  return view.unmount;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('tokenProvider', () => {
  it('挂载即取票登录，卸载时登出', async () => {
    const engine = new FakeEngine();
    const unmount = setup(engine, () => Promise.resolve({ token: 'tk' }));
    await flush();
    expect(engine.calls).toContain('login:tk');
    unmount();
    expect(engine.calls[engine.calls.length - 1]).toBe('logout');
  });

  it('启动时取票失败，拨号时补一次：成功就照常拨出', async () => {
    const engine = new FakeEngine();
    let next: () => Promise<KitToken> = () => Promise.reject(new Error('后台挂了'));
    setup(engine, () => next());
    await flush();
    expect(engine.calls.some((c) => c.startsWith('login:'))).toBe(false);
    next = () => Promise.resolve({ token: 'again' });
    fireEvent.click(screen.getByTestId('place'));
    await flush();
    expect(engine.calls).toContain('login:again');
    expect(engine.calls).toContain('call:bob:audio');
  });

  it('补也补不上：收起拨出页、提示，不发 invite', async () => {
    const engine = new FakeEngine();
    setup(engine, () => Promise.reject(new Error('后台挂了')));
    await flush();
    fireEvent.click(screen.getByTestId('place'));
    await flush();
    expect(engine.calls.some((c) => c.startsWith('call:'))).toBe(false);
    expect(document.body.textContent).toContain(t('hint.serviceUnavailable'));
  });

  it('登录回 2003：提示查网络', async () => {
    const engine = new FakeEngine();
    engine.loginError = new RtcError(ErrorCode.networkUnreachable);
    setup(engine, () => Promise.resolve({ token: 'tk' }));
    await flush();
    fireEvent.click(screen.getByTestId('place'));
    await flush();
    expect(engine.calls.some((c) => c.startsWith('call:'))).toBe(false);
    expect(document.body.textContent).toContain(t('hint.serviceUnreachable'));
  });
});

describe('没配 tokenProvider', () => {
  it('不碰登录；拨号回 2007 时说人话', async () => {
    const engine = new FakeEngine();
    engine.callError = new RtcError(ErrorCode.notLoggedIn);
    setup(engine);
    await flush();
    fireEvent.click(screen.getByTestId('place'));
    await flush();
    expect(engine.calls.some((c) => c.startsWith('login:') || c === 'logout')).toBe(false);
    expect(document.body.textContent).toContain(t('hint.serviceUnreachable'));
  });
});
