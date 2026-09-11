import { SDK_VERSION, VideoProfiles } from '@im-rtc/call-engine';
import type { ReactNode } from 'react';

import type { DemoSettings, VideoProfileKey } from './settingsStore.js';
import { VIDEO_PROFILE_KEYS } from './settingsStore.js';
import type { UpdateSetting } from './useDemoSettings.js';
import { describeBrowser } from './userAgent.js';

/** SettingsProps 是设置卡片的参数。 */
export interface SettingsProps {
  readonly settings: DemoSettings;
  readonly onChange: UpdateSetting;
  /** 本次登录实际用的采集档位。与 settings.videoProfile 不同时提示「重登才生效」。 */
  readonly activeProfile: VideoProfileKey;
  readonly deviceId: string;
}

const CHECK_ROW = { display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, color: 'inherit' } as const;
const CHECKBOX = { width: 'auto' } as const;

/**
 * 设置。与 iOS / Android / 桌面 Demo 的设置页对齐：来电横幅、详细日志、采集画质、关于。
 *
 * Android 那一项「硬件 H.264 编码」**Web 没有**：编码器由浏览器自己选，页面管不着。
 */
export function Settings({ settings, onChange, activeProfile, deviceId }: SettingsProps): ReactNode {
  const browser = describeBrowser(navigator.userAgent);
  const isProfilePending = settings.videoProfile !== activeProfile;

  return (
    <div className="card" data-testid="settings">
      <h2>设置</h2>

      <label style={CHECK_ROW}>
        <input type="checkbox" style={CHECKBOX} checked={settings.bannerFirst}
               onChange={(e) => onChange('bannerFirst', e.target.checked)} />
        来电先出横幅
      </label>
      <div className="note" style={{ marginTop: 2 }}>关掉则来电直接进来电页。立即生效。</div>

      <label style={{ ...CHECK_ROW, marginTop: 12 }}>
        <input type="checkbox" style={CHECKBOX} checked={settings.logLevel === 'debug'}
               onChange={(e) => onChange('logLevel', e.target.checked ? 'debug' : 'info')} />
        详细日志
      </label>
      <div className="note" style={{ marginTop: 2 }}>打开是 debug 级，关掉是 info 级。立即生效。</div>

      <label style={{ marginTop: 12 }}>采集画质</label>
      <div className="picks">
        {VIDEO_PROFILE_KEYS.map((key) => (
          <button key={key} type="button" className="pick" aria-pressed={settings.videoProfile === key}
                  onClick={() => onChange('videoProfile', key)}>
            {VideoProfiles[key].name}
          </button>
        ))}
      </div>
      <div className="note" style={{ marginTop: 2, color: isProfilePending ? '#e5484d' : undefined }}>
        换了要<b>退出重登</b>才生效（登录时按这一档建采集）。
        本次登录用的是 {VideoProfiles[activeProfile].name}。
      </div>

      <table style={{ marginTop: 16 }}>
        <tbody>
          <tr><th>SDK</th><td>im-rtc-web {SDK_VERSION}</td></tr>
          <tr>
            <th>WebRTC</th>
            <td title={navigator.userAgent}>
              浏览器内置，版本跟随浏览器{browser !== '' && <span className="muted">（{browser}）</span>}
            </td>
          </tr>
          <tr><th>设备 ID</th><td>{deviceId}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
