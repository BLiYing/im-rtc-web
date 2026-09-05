/**
 * `@im-rtc/call-uikit-react` —— im-rtc 的 React 通话界面。
 *
 * **它只消费 engine 的公开事件表**（`events.ts` = 设计文档 §7.5），没有任何私有通道。
 * 想自画 UI 的宿主拿到的信息与这里完全一致——这是产品边界，不是巧合。
 *
 * 最小用法：
 * ```tsx
 * <CallProvider engine={engine}>
 *   <YourApp />
 *   <CallOverlay />
 * </CallProvider>
 * ```
 */

export { CallProvider, CallContext } from './CallProvider.js';
export type { CallActions, CallContextValue, CallProviderProps } from './CallProvider.js';
export { useCall } from './useCall.js';
export { useElapsed } from './useElapsed.js';

export { CallOverlay } from './components/CallOverlay.js';
export { ActiveCall } from './components/ActiveCall.js';
export { IncomingCall } from './components/IncomingCall.js';
export { CallEnded } from './components/CallEnded.js';
export { MiniWindow } from './components/MiniWindow.js';
export { ControlBar } from './components/ControlBar.js';
export { VideoTile } from './components/VideoTile.js';
export type { VideoTileProps } from './components/VideoTile.js';

export { initialCallView, isCallVisible, reduceCallView } from './state/callView.js';
export type {
  CallPhase,
  CallViewState,
  RemoteParticipant,
  SelfState,
  ViewAction,
} from './state/callView.js';

export { MAX_TILES, cellSide, focusedLayer, gridDimensions, tileLayer, visibleTiles } from './layout/grid.js';
export { useElementSize } from './useElementSize.js';
export type { GridDimensions } from './layout/grid.js';

export { elapsedSec, formatDuration } from './format/duration.js';
export { endReasonText, endedHoldMs } from './format/endReason.js';

export { styles } from './styles.js';
