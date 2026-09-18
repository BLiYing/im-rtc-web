/**
 * 浏览器替宿主盯两件事：标签页回到前台（`visibilitychange`）、网络变了（`online` 与
 * `navigator.connection` 的 `change`），转成 `Connection.setAppForeground` / `notifyNetworkChanged`。
 *
 * iOS / Android 由 Kit 喂这两个信号；Web 没有「Kit 起来了」这个时机，而这些事件在浏览器里是全局的，
 * 所以登录时由 `EngineSession` 自己挂上、登出摘掉——**宿主什么都不用写**。宿主自己再调
 * `CallEngine.setAppForeground` / `notifyNetworkChanged` 也无妨：探测一次只探一个，立刻重连两次至少隔 2 秒。
 *
 * 不在浏览器里（Node 单测、SSR）就什么都不挂。
 */

/** BrowserSignalTarget 是收信号的那一方（`Connection`）。 */
export interface BrowserSignalTarget {
  setAppForeground(foreground: boolean): void;
  notifyNetworkChanged(): void;
}

/** BrowserEnv 是要听的三个事件源，单测可注入。 */
export interface BrowserEnv {
  readonly document?: (EventTarget & { readonly visibilityState: string }) | undefined;
  readonly window?: EventTarget | undefined;
  /** `navigator.connection`（Chrome 系有，Safari / Firefox 没有）。 */
  readonly connection?: EventTarget | undefined;
}

function defaultEnv(): BrowserEnv {
  const g = globalThis as {
    document?: EventTarget & { visibilityState: string };
    window?: EventTarget;
    navigator?: { connection?: EventTarget };
  };
  return { document: g.document, window: g.window, connection: g.navigator?.connection };
}

/** watchBrowserSignals 挂上监听，返回摘除函数。 */
export function watchBrowserSignals(target: BrowserSignalTarget, env: BrowserEnv = defaultEnv()): () => void {
  const removers: (() => void)[] = [];
  const listen = (source: EventTarget | undefined, type: string, handler: () => void): void => {
    if (source === undefined || typeof source.addEventListener !== 'function') return;
    source.addEventListener(type, handler);
    removers.push(() => source.removeEventListener(type, handler));
  };
  const doc = env.document;
  listen(doc, 'visibilitychange', () => target.setAppForeground(doc?.visibilityState === 'visible'));
  // 断网期间不报：没网可连。`online` 就是「从没网恢复到有网」。
  listen(env.window, 'online', () => target.notifyNetworkChanged());
  listen(env.connection, 'change', () => target.notifyNetworkChanged());
  return (): void => {
    for (const remove of removers.splice(0)) remove();
  };
}
