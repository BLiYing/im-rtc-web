import { useContext } from 'react';

import type { CallContextValue } from './CallProvider.js';
import { CallContext } from './CallProvider.js';

/**
 * useCall 取通话状态与动作。
 *
 * 不在 Provider 里用时**直接抛错**而不是返回 null：返回 null 会让每个调用点
 * 都写一遍空判断，而这本来是个装配错误，应该在开发时就炸掉。
 */
export function useCall(): CallContextValue {
  const value = useContext(CallContext);
  if (value === null) {
    throw new Error('useCall 必须在 <CallProvider> 里使用');
  }
  return value;
}
