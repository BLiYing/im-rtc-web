import { setLogLevel } from '@im-rtc/call-engine';
import { useCallback, useRef, useState } from 'react';

import type { DemoSettings } from './settingsStore.js';
import { browserStore, loadSettings, saveSetting } from './settingsStore.js';

/** UpdateSetting 改一项设置。 */
export type UpdateSetting = <K extends keyof DemoSettings>(key: K, value: DemoSettings[K]) => void;

/** DemoSettingsHandle 是 useDemoSettings 的返回值。 */
export interface DemoSettingsHandle {
  readonly settings: DemoSettings;
  /**
   * 登录时读采集档位用。**走 ref**：login 是依赖为空的 useCallback，
   * 直接读 state 会拿到首次渲染时的旧值；把 settings 放进依赖又会让自动重登的 effect 跟着重跑。
   */
  readonly settingsRef: { readonly current: DemoSettings };
  readonly update: UpdateSetting;
}

/**
 * useDemoSettings 持有设置、写存储、让能立即生效的那几项立即生效。
 *
 * - 横幅开关：state 一变，App 传给 `<CallProvider bannerFirst>` 的值就变了；
 * - 日志档位：这里直接 `setLogLevel`；
 * - 采集档位：**只在下次登录时读**（WebRTCAdapter 构造时定档），这里什么都不用做。
 *
 * 启动时的日志档位由 App.tsx 模块顶部按存储设好，不在这里设——那一步要早于任何 engine 创建。
 */
export function useDemoSettings(): DemoSettingsHandle {
  const [settings, setSettings] = useState(() => loadSettings(browserStore()));
  const settingsRef = useRef(settings);

  const update = useCallback<UpdateSetting>((key, value) => {
    const next: DemoSettings = { ...settingsRef.current, [key]: value };
    settingsRef.current = next;
    setSettings(next);
    // 写不进去（隐私模式）也不拦：本次会话照样生效，只是刷新后回到默认值。
    saveSetting(browserStore(), key, value);
    if (key === 'logLevel') setLogLevel(next.logLevel);
  }, []);

  return { settings, settingsRef, update };
}
