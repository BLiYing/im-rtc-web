import { SDK_VERSION, VideoProfiles } from 'im-rtc-call-engine';
import type { ReactNode } from 'react';

import type { DemoSettings, LanguageChoice, VideoProfileKey } from './settingsStore.js';
import { LANGUAGE_CHOICES, VIDEO_PROFILE_KEYS } from './settingsStore.js';
import type { UpdateSetting } from './useDemoSettings.js';
import { describeBrowser } from './userAgent.js';
import { dt } from './demoText.js';

/** SettingsProps 是设置卡片的参数。 */
export interface SettingsProps {
  readonly settings: DemoSettings;
  readonly onChange: UpdateSetting;
  /** 本次登录实际用的采集档位。与 settings.videoProfile 不同时提示「重登才生效」。 */
  readonly activeProfile: VideoProfileKey;
  readonly deviceId: string;
}

/** 语言各用自己的名字显示，任何语言的界面里都认得出。 */
const LANGUAGE_NAMES: Record<LanguageChoice, string> = { auto: '跟随系统 / Auto', 'zh-CN': '简体中文', en: 'English' };
const CHECK_ROW = { display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, color: 'inherit' } as const;
const CHECKBOX = { width: 'auto' } as const;

/**
 * 设置。与 iOS / Android / 桌面 Demo 的设置页对齐：来电横幅、静音来电铃声、详细日志、采集画质、关于。
 *
 * 桌面 Demo 没有「静音来电铃声」：它没有 Kit、本来就不放铃声（只有横幅 + 系统通知）。
 *
 * Android 那一项「硬件 H.264 编码」**Web 没有**：编码器由浏览器自己选，页面管不着。
 */
export function Settings({ settings, onChange, activeProfile, deviceId }: SettingsProps): ReactNode {
  const browser = describeBrowser(navigator.userAgent);
  const isProfilePending = settings.videoProfile !== activeProfile;

  return (
    <div className="card" data-testid="settings">
      <h2>{dt('demo.settings.title')}</h2>

      <label style={CHECK_ROW}>
        <input type="checkbox" style={CHECKBOX} checked={settings.bannerFirst}
               onChange={(e) => onChange('bannerFirst', e.target.checked)} />
        {dt('demo.settings.bannerFirst')}
      </label>
      <div className="note" style={{ marginTop: 2 }}>{dt('demo.settings.bannerFirstNote')}</div>

      <label style={{ ...CHECK_ROW, marginTop: 12 }}>
        <input type="checkbox" style={CHECKBOX} checked={settings.ringtoneMuted}
               onChange={(e) => onChange('ringtoneMuted', e.target.checked)} />
        {dt('demo.settings.ringtoneMuted')}
      </label>
      <div className="note" style={{ marginTop: 2 }}>{dt('demo.settings.ringtoneMutedNote')}</div>

      <label style={{ ...CHECK_ROW, marginTop: 12 }}>
        <input type="checkbox" style={CHECKBOX} checked={settings.logLevel === 'debug'}
               onChange={(e) => onChange('logLevel', e.target.checked ? 'debug' : 'info')} />
        {dt('demo.settings.verboseLog')}
      </label>
      <div className="note" style={{ marginTop: 2 }}>{dt('demo.settings.verboseLogNote')}</div>

      <label style={{ marginTop: 12 }}>语言 / Language</label>
      <div className="picks">
        {LANGUAGE_CHOICES.map((choice) => (
          <button key={choice} type="button" className="pick" aria-pressed={settings.language === choice}
                  data-testid={`language-${choice}`} onClick={() => onChange('language', choice)}>
            {LANGUAGE_NAMES[choice]}
          </button>
        ))}
      </div>
      <div className="note" style={{ marginTop: 2 }}>{dt('demo.settings.languageNote')}</div>

      <label style={{ marginTop: 12 }}>{dt('demo.settings.profile')}</label>
      <div className="picks">
        {VIDEO_PROFILE_KEYS.map((key) => (
          <button key={key} type="button" className="pick" aria-pressed={settings.videoProfile === key}
                  onClick={() => onChange('videoProfile', key)}>
            {VideoProfiles[key].name}
          </button>
        ))}
      </div>
      <div className="note" style={{ marginTop: 2, color: isProfilePending ? '#e5484d' : undefined }}>
        {dt('demo.settings.profileNote')}
        {dt('demo.settings.profileActive', { name: VideoProfiles[activeProfile].name })}
      </div>

      <table style={{ marginTop: 16 }}>
        <tbody>
          <tr><th>SDK</th><td>im-rtc-web {SDK_VERSION}</td></tr>
          <tr>
            <th>WebRTC</th>
            <td title={navigator.userAgent}>
              {dt('demo.settings.webrtcValue')}{browser !== '' && <span className="muted">（{browser}）</span>}
            </td>
          </tr>
          <tr><th>{dt('demo.settings.deviceId')}</th><td>{deviceId}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
