import type { ReactNode } from 'react';
import { useState } from 'react';

/** LoginPanelProps 是登录面板的参数。 */
export interface LoginPanelProps {
  readonly onLogin: (server: string, username: string, synthetic: boolean) => Promise<void>;
}

/**
 * 登录面板。
 *
 * 「合成音视频源」默认勾上：**两个标签页对拨时不该抢同一个摄像头**，
 * 而且合成画面上有走动的秒针，肉眼就能分辨「通了」与「冻住了」。
 */
export function LoginPanel({ onLogin }: LoginPanelProps): ReactNode {
  const [server, setServer] = useState('http://127.0.0.1:8787');
  const [username, setUsername] = useState('alice');
  const [synthetic, setSynthetic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = (): void => {
    setBusy(true);
    setError('');
    void onLogin(server.trim(), username.trim(), synthetic)
      .catch((err: unknown) => setError(String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="card">
      <h2>登录</h2>
      <div className="row">
        <div>
          <label htmlFor="server">服务端</label>
          <input id="server" value={server} onChange={(e) => setServer(e.target.value)} />
        </div>
        <div>
          <label htmlFor="username">用户名</label>
          <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <button type="button" onClick={submit} disabled={busy || username.trim() === ''}>
          {busy ? '登录中…' : '登录'}
        </button>
      </div>
      <div className="note">
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={synthetic}
            style={{ width: 'auto' }}
            onChange={(e) => setSynthetic(e.target.checked)}
          />
          用合成音视频源（不碰摄像头/麦克风，两个标签页对拨时更方便）
        </label>
      </div>
      {error !== '' && <div className="note" style={{ color: '#e5484d' }}>{error}</div>}
      <div className="note">
        免密登录只在服务端带 <code>-demo-login</code> 时存在；
        真实宿主用自己的账号体系换 token。
      </div>
    </div>
  );
}
