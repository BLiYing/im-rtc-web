import type { CallEngine } from '@im-rtc/call-engine';
import { CallEngine as Engine, WebRTCAdapter, setLogLevel, setLogSink } from '@im-rtc/call-engine';
import { CallOverlay, CallProvider } from '@im-rtc/call-uikit-react';
import { SyntheticMediaSource, browserMediaSource } from '@demo/synthetic';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import { demoLogin } from './api.js';
import type { ConnPhase } from '@demo/connection-guard';
import { guardConnection } from '@demo/connection-guard';
import { toEntry } from './logTypes.js';
import { RemoteLogSink } from './remoteLog.js';
import { CallHistory } from './CallHistory.js';
import { EngineLog } from './EngineLog.js';
import { Dialer } from './Dialer.js';
import { LoginPanel } from './LoginPanel.js';

setLogLevel('debug');

const CONN_LABEL: Readonly<Record<ConnPhase, string>> = {
  connected: '● 已连接',
  reconnecting: '◌ 重连中',
  refreshing: '◌ 正在换接入票',
  dead: '○ 已断开',
};

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
  const [conn, setConn] = useState<{ phase: ConnPhase; detail: string }>({
    phase: 'connected', detail: '',
  });
  const [notice, setNotice] = useState('');

  const login = useCallback(
    async (server: string, username: string, synthetic: boolean): Promise<void> => {
      const token = await demoLogin(server, username);
      const deviceId = `demo-react-${username}`;

      /*
        把 engine 的日志送回服务端落盘（仅开发）。engine 现在会把**每一个公开事件**
        也写进日志，所以这一条链路等于把两端的事件流搬到了服务端，
        跟服务端自己的日志放在同一条时间轴上读——不用再手动复制粘贴。

        文件落在 im-rtc-server 的 dev-logs/client-web-<用户名>.log。
      */
      const remote = new RemoteLogSink(server, `web-${username}`);
      remote.start();
      setLogSink((level, message, fields) => {
        remote.push(toEntry(level, message, fields as Record<string, unknown>));
      });
      const source = synthetic ? new SyntheticMediaSource(username) : browserMediaSource;
      const engine = new Engine({
        url: `${server.replace(/^http/, 'ws')}/v1/ws`,
        deviceId,
        media: new WebRTCAdapter(source),
      });
      /*
        换票与「被踢就回登录页」这套处置**是宿主的活**，所以写在 Demo 里而不是 SDK 里
        （见 connectionGuard.ts 开头）。这也是这个 Demo 存在的意义之一：
        证明协议 §1.5 那条规则宿主真的做得到。
      */
      guardConnection(engine, () => demoLogin(server, username), {
        onPhase: (phase, detail) => setConn({ phase, detail }),
        onDead: (reason) => {
          engine.logout();
          setSession(null);
          setNotice(reason);
        },
      });

      await engine.login(token);
      setNotice('');
      setConn({ phase: 'connected', detail: '新会话' });
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

      {notice !== '' && (
        <div className="card" style={{ borderColor: '#e5484d' }}>
          <b style={{ color: '#e5484d' }}>{notice}</b>
        </div>
      )}

      {session === null ? (
        <LoginPanel onLogin={login} />
      ) : (
        <CallProvider engine={session.engine}>
          <div className="card">
            <h2>已登录</h2>
            <div>
              <b>{session.uid}</b> <span className="muted">（{session.deviceId}）</span>
            </div>
            {/*
              连接状态必须画出来。**服务端重启后页面一直显示「已登录」**、
              其实什么都发不出去——这个毛病之所以能藏那么久，就是因为界面上看不见。
            */}
            <div className="note" data-testid="conn-status">
              {CONN_LABEL[conn.phase]}
              {conn.detail !== '' && <span className="muted"> · {conn.detail}</span>}
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
