import type { CallEngine } from 'im-rtc-call-engine';
import { useCallback, useEffect, useRef } from 'react';

import type { FailureKind, TokenProvider } from './kitSession.js';
import { KitSession } from './kitSession.js';

/** 设备此刻有没有网。拿不到 `navigator` 时（SSR / 测试环境）当作有网。 */
function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function browserSchedule(delayMs: number, task: () => void): () => void {
  const timer = setTimeout(task, delayMs);
  return () => clearTimeout(timer);
}

/**
 * useKitSession 在配了 `tokenProvider` 时由 Kit 接管登录（见 `kitSession.ts`），
 * 返回「确保已登录」的那一下；**没配就永远立即返回 `null`**——宿主自己管登录，行为与 2.1.x 一致。
 *
 * provider 放 ref：宿主多半写成内联箭头函数，每次渲染都是新引用，不能因此重启会话。
 */
export function useKitSession(
  engine: CallEngine,
  tokenProvider: TokenProvider | undefined,
): () => Promise<FailureKind | null> {
  const providerRef = useRef(tokenProvider);
  providerRef.current = tokenProvider;
  const sessionRef = useRef<KitSession | null>(null);
  const enabled = tokenProvider !== undefined;

  useEffect(() => {
    if (!enabled) return undefined;
    const session = new KitSession({
      engine,
      provider: () => {
        const provider = providerRef.current;
        return provider === undefined ? Promise.reject(new Error('tokenProvider 已移除')) : provider();
      },
      schedule: browserSchedule,
      isOnline: browserOnline,
    });
    sessionRef.current = session;
    const off = [
      engine.on('connected', () => session.onConnected()),
      engine.on('disconnected', () => session.onDisconnected()),
      engine.on('kickedOut', (e) => session.onKickedOut(e.reason)),
      engine.on('tokenWillExpire', () => session.onTokenWillExpire()),
    ];
    // 网络回来、页面回到前台：退避里等着的立刻再试（engine 自己的同类监听只管已登录的连接）。
    const onOnline = (): void => session.onNetworkRestored();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') session.onNetworkRestored();
    };
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    session.start();
    return () => {
      for (const unsubscribe of off) unsubscribe();
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      if (sessionRef.current === session) sessionRef.current = null;
      session.stop();
    };
  }, [engine, enabled]);

  return useCallback(async (): Promise<FailureKind | null> => {
    const session = sessionRef.current;
    return session === null ? null : session.ensure();
  }, []);
}
