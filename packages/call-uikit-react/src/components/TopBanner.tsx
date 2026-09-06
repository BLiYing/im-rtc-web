import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { useCall } from '../useCall.js';
import { styles } from '../styles.js';
import { callMotion } from '../theme.js';
import { isNetworkPoor } from './Icon.js';

/**
 * TopBanner 是通话页顶部的橙条（规范 §08）：「正在重连…」「连接已断开」「对方网络不佳」。
 *
 * 重连横幅跟着连接状态走，**通话不结束、计时器继续走**。
 * 网络不佳的横幅只停 2s，之后收起成格子右下的角标——**不要一直霸占顶部**。
 */
export function TopBanner(): ReactNode {
  const { state } = useCall();
  const poorPeer = state.participants.find((p) => isNetworkPoor(p.networkLevel));
  const [showPoor, setShowPoor] = useState(false);

  // 某人网络刚变差那一刻出横幅，2s 后收成角标；恢复后再变差会再出一次。
  const poorUid = poorPeer?.uid ?? '';
  useEffect(() => {
    if (poorUid === '') {
      setShowPoor(false);
      return;
    }
    setShowPoor(true);
    const timer = setTimeout(() => setShowPoor(false), callMotion.networkBannerMs);
    return () => clearTimeout(timer);
  }, [poorUid]);

  if (state.connection === 'reconnecting') {
    return <div style={styles.topBanner} role="status" data-testid="banner-reconnecting">正在重连…</div>;
  }
  if (state.connection === 'lost') {
    return <div style={styles.topBanner} role="status" data-testid="banner-lost">连接已断开</div>;
  }
  if (showPoor) {
    return <div style={styles.topBanner} role="status" data-testid="banner-network">对方网络不佳</div>;
  }
  return null;
}
