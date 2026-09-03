import type { CallEngine } from '@im-rtc/call-engine';
import { CallEngine as Engine, WebRTCAdapter, setLogLevel } from '@im-rtc/call-engine';
import { CallOverlay, CallProvider } from '@im-rtc/call-uikit-react';
import { SyntheticMediaSource, browserMediaSource } from '@demo/synthetic';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import { demoLogin } from './api.js';
import { CallHistory } from './CallHistory.js';
import { EngineLog } from './EngineLog.js';
import { Dialer } from './Dialer.js';
import { LoginPanel } from './LoginPanel.js';

setLogLevel('debug');

interface Session {
  readonly engine: CallEngine;
  readonly server: string;
  readonly token: string;
  readonly uid: string;
  readonly deviceId: string;
}

/**
 * 引 uikit 的 Demo。
 *
 * **整页没有一行通话界面代码**：来电浮层、九宫格、小窗全在 `<CallOverlay />` 里。
 * 这一页与 `demo/`（自画 UI）是同一套 engine 的两条集成路线——
 * 两条都跑得通，才说明公开回调表是够用的。
 */
export function App(): ReactNode {
  const [session, setSession] = useState<Session | null>(null);

  const login = useCallback(
    async (server: string, username: string, synthetic: boolean): Promise<void> => {
      const token = await demoLogin(server, username);
      const deviceId = `demo-react-${username}`;
      const source = synthetic ? new SyntheticMediaSource(username) : browserMediaSource;
      const engine = new Engine({
        url: `${server.replace(/^http/, 'ws')}/v1/ws`,
        deviceId,
        media: new WebRTCAdapter(source),
      });
      await engine.login(token);
      setSession({ engine, server, token, uid: username, deviceId });
    },
    [],
  );

  return (
    <>
      <h1>im-rtc · 引 uikit 的 Demo</h1>
      <p className="lead">
        通话界面全部来自 <code>@im-rtc/call-uikit-react</code>，这一页只写了登录、拨号与记录——
        也就是<b>宿主本来就该自己写的那部分</b>。
      </p>

      {session === null ? (
        <LoginPanel onLogin={login} />
      ) : (
        <CallProvider engine={session.engine}>
          <div className="card">
            <h2>已登录</h2>
            <div>
              <b>{session.uid}</b> <span className="muted">（{session.deviceId}）</span>
            </div>
          </div>
          <Dialer server={session.server} token={session.token} deviceId={session.deviceId} />
          <CallHistory server={session.server} token={session.token} uid={session.uid} />
          <EngineLog />
          <CallOverlay />
        </CallProvider>
      )}
    </>
  );
}
