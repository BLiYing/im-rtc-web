import { VideoProfiles } from '@im-rtc/call-engine';
import { describe, expect, it } from 'vitest';

import type { KeyValueStore } from '../src/settingsStore.js';
import { DEFAULT_SETTINGS, SETTINGS_KEY_PREFIX, loadSettings, saveSetting } from '../src/settingsStore.js';

/** memoryStore 是内存版 localStorage。 */
function memoryStore(): KeyValueStore & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

/** 隐私模式：每次读写都抛。 */
const throwingStore: KeyValueStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('默认值', () => {
  it('没有存储时与加设置卡片之前的行为一致：先出横幅、debug、720p', () => {
    expect(loadSettings(null)).toEqual({ bannerFirst: true, logLevel: 'debug', videoProfile: 'p720' });
    expect(VideoProfiles[DEFAULT_SETTINGS.videoProfile].name).toBe('720p');
  });

  it('存储是空的也用默认值', () => {
    expect(loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
  });

  it('存的值不认识就用默认值，不信存储里的东西', () => {
    const store = memoryStore();
    store.setItem(`${SETTINGS_KEY_PREFIX}bannerFirst`, 'yes');
    store.setItem(`${SETTINGS_KEY_PREFIX}logLevel`, 'warn');
    store.setItem(`${SETTINGS_KEY_PREFIX}videoProfile`, '4k');
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
  });

  it('原型链上的键不算合法档位', () => {
    const store = memoryStore();
    store.setItem(`${SETTINGS_KEY_PREFIX}videoProfile`, 'toString');
    expect(loadSettings(store).videoProfile).toBe('p720');
  });
});

describe('持久化', () => {
  it('写进去再读出来，键带 im-rtc-demo.settings. 前缀', () => {
    const store = memoryStore();
    expect(saveSetting(store, 'bannerFirst', false)).toBe(true);
    expect(saveSetting(store, 'logLevel', 'info')).toBe(true);
    expect(saveSetting(store, 'videoProfile', 'p1080')).toBe(true);

    expect([...store.items.keys()].sort()).toEqual([
      'im-rtc-demo.settings.bannerFirst',
      'im-rtc-demo.settings.logLevel',
      'im-rtc-demo.settings.videoProfile',
    ]);
    expect(loadSettings(store)).toEqual({ bannerFirst: false, logLevel: 'info', videoProfile: 'p1080' });
  });

  it('只改一项时其余项仍是默认值', () => {
    const store = memoryStore();
    saveSetting(store, 'videoProfile', 'p360');
    expect(loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, videoProfile: 'p360' });
  });

  it('关掉的横幅开关能再打开（false 不会被当成「没存」）', () => {
    const store = memoryStore();
    saveSetting(store, 'bannerFirst', false);
    saveSetting(store, 'bannerFirst', true);
    expect(loadSettings(store).bannerFirst).toBe(true);
  });
});

describe('隐私模式', () => {
  it('读抛异常时用默认值，不往外抛', () => {
    expect(loadSettings(throwingStore)).toEqual(DEFAULT_SETTINGS);
  });

  it('写抛异常时返回 false，不往外抛', () => {
    expect(saveSetting(throwingStore, 'logLevel', 'info')).toBe(false);
    expect(saveSetting(null, 'logLevel', 'info')).toBe(false);
  });
});
