import type { LogLevel } from 'im-rtc-call-engine';
import { VideoProfiles } from 'im-rtc-call-engine';
import type { Locale } from 'im-rtc-call-uikit-react';

/** VideoProfileKey 是 engine 导出的采集档位的键（p360 / p720 / p1080）。 */
export type VideoProfileKey = keyof typeof VideoProfiles;

/** DemoLogLevel 是设置卡片能切的两档：详细（debug）与常规（info）。 */
export type DemoLogLevel = Extract<LogLevel, 'debug' | 'info'>;

/**
 * DemoSettings 是设置卡片上那几项。
 *
 * `bannerFirst` / `ringtoneMuted` 不带 is/should 前缀是**有意的**：它们就是 `<CallProvider>` 上同名的开关，
 * 与 iOS / Android Kit 配置同名同义，换个名字反而对不上。
 */
/** LanguageChoice 是设置里的语言：跟随系统，或固定一种（与桌面 Demo 的三选一同形）。 */
export type LanguageChoice = 'auto' | Locale;

export const LANGUAGE_CHOICES: readonly LanguageChoice[] = ['auto', 'zh-CN', 'en'];

export interface DemoSettings {
  readonly bannerFirst: boolean;
  readonly ringtoneMuted: boolean;
  readonly logLevel: DemoLogLevel;
  readonly videoProfile: VideoProfileKey;
  readonly language: LanguageChoice;
}

/** DEFAULT_SETTINGS 是读不到存储时的值——与加设置卡片之前的行为一致（debug、720p、先出横幅、响铃）。 */
export const DEFAULT_SETTINGS: DemoSettings = {
  bannerFirst: true,
  ringtoneMuted: false,
  logLevel: 'debug',
  videoProfile: 'p720',
  language: 'auto',
};

/** 采集档位的显示顺序。 */
export const VIDEO_PROFILE_KEYS: readonly VideoProfileKey[] = ['p360', 'p720', 'p1080'];

export const SETTINGS_KEY_PREFIX = 'im-rtc-demo.settings.';

/** KeyValueStore 是用到的那两个 Storage 方法。测试里换成内存实现。 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * browserStore 取 localStorage。
 *
 * 存在 **localStorage** 而不是 sessionStorage：这些是偏好，双开标签页共用一份正合适，
 * 也不会像「自动重登」那样把另一个标签页顶下线（见 App.tsx 的 remember）。
 * 有的浏览器在禁用站点数据时**连访问 `localStorage` 这个变量都会抛**，所以这里也要包住。
 */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function read(store: KeyValueStore | null, key: keyof DemoSettings): string | null {
  if (store === null) return null;
  try {
    return store.getItem(SETTINGS_KEY_PREFIX + key);
  } catch {
    return null; // 隐私模式下会抛；读不到就用默认值
  }
}

/** readBool 只认 'true' / 'false'，别的一律当没存。 */
function readBool(store: KeyValueStore | null, key: 'bannerFirst' | 'ringtoneMuted'): boolean {
  const value = read(store, key);
  return value === 'true' ? true : value === 'false' ? false : DEFAULT_SETTINGS[key];
}

function isVideoProfileKey(value: string | null): value is VideoProfileKey {
  return VIDEO_PROFILE_KEYS.some((key) => key === value);
}

/** loadSettings 读出全部设置。**存的值不认识就用默认值**——存储里的东西不能直接信。 */
export function loadSettings(store: KeyValueStore | null): DemoSettings {
  const level = read(store, 'logLevel');
  const profile = read(store, 'videoProfile');
  const language = read(store, 'language');
  return {
    bannerFirst: readBool(store, 'bannerFirst'),
    ringtoneMuted: readBool(store, 'ringtoneMuted'),
    logLevel: level === 'debug' || level === 'info' ? level : DEFAULT_SETTINGS.logLevel,
    videoProfile: isVideoProfileKey(profile) ? profile : DEFAULT_SETTINGS.videoProfile,
    language: LANGUAGE_CHOICES.find((c) => c === language) ?? DEFAULT_SETTINGS.language,
  };
}

/** saveSetting 写一项。写不进去（隐私模式、配额满）返回 false：本次会话里仍然生效，只是刷新后记不住。 */
export function saveSetting<K extends keyof DemoSettings>(
  store: KeyValueStore | null,
  key: K,
  value: DemoSettings[K],
): boolean {
  if (store === null) return false;
  try {
    store.setItem(SETTINGS_KEY_PREFIX + key, String(value));
    return true;
  } catch {
    return false;
  }
}
