import type { ReactNode } from 'react';
import { useState } from 'react';

/** remembered 读上次填过的值。刷新/重开标签页不用再敲一遍。 */
function remembered(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`im-rtc-demo.${key}`) ?? fallback;
  } catch {
    return fallback; // 隐私模式下 localStorage 会抛
  }
}

/** LoginPanelProps 是登录面板的参数。 */
export interface LoginPanelProps {
  readonly onLogin: (server: string, username: string, synthetic: boolean) => Promise<void>;
}

/**
 * 登录面板。
 *
 * 「合成音视频源」**默认关**。它是给「同一台机器双开标签页对拨」用的：
 * 两个标签页抢同一个摄像头会打架，而合成画面上有走动的秒针，
 * 肉眼就能分辨「通了」与「冻住了」。
 *
 * 但默认打开会骗人——**跨设备联调时你对着麦克风说话，对端听到的却是 440Hz 正弦波**，
 * 而且「摄像头没亮」看起来像权限出了问题。实测就是这么误判了一轮。
 * 所以默认走真实设备，要双开时自己勾。
 */
export function LoginPanel({ onLogin }: LoginPanelProps): ReactNode {
  const [server, setServer] = useState(remembered('server', 'http://127.0.0.1:8787'));
  const [username, setUsername] = useState(remembered('username', 'alice'));
  const [synthetic, setSynthetic] = useState(false);
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
          用合成音视频源（不碰摄像头/麦克风）——<b>同一台机器双开标签页对拨时勾上</b>，跨设备联调请保持关闭
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
