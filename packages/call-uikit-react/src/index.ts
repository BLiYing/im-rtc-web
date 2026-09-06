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
export type { CallActions, CallContextValue, CallProviderProps, InviteCandidate } from './CallProvider.js';
export { useCall } from './useCall.js';
export { useElapsed } from './useElapsed.js';
export { useAutoHide } from './useAutoHide.js';
export { usePipDrag } from './usePipDrag.js';
export type { PipDragOptions, PipDragResult } from './usePipDrag.js';
export type { EnsureResult, PermissionGate, PermissionPromptView } from './usePermissionGate.js';

export { CallOverlay } from './components/CallOverlay.js';
export { ActiveCall, pickLayout } from './components/ActiveCall.js';
export type { CallLayout } from './components/ActiveCall.js';
export { IncomingCall } from './components/IncomingCall.js';
export { CallEnded } from './components/CallEnded.js';
export { MiniWindow } from './components/MiniWindow.js';
export { ControlBar, showsCameraButton } from './components/ControlBar.js';
export { ControlButton } from './components/ControlButton.js';
export type { ControlButtonProps } from './components/ControlButton.js';
export { Icon, NetworkBars, barsLit, isNetworkPoor, networkText } from './components/Icon.js';
export type { IconName } from './components/Icon.js';
export { VideoTile } from './components/VideoTile.js';
export type { VideoTileProps } from './components/VideoTile.js';
export { PipView } from './components/PipView.js';
export { InvitePicker } from './components/InvitePicker.js';
export { PromptCard } from './components/PromptCard.js';
export { TopBanner } from './components/TopBanner.js';

export {
  canShowInvite, initialCallView, inviteSlotsLeft, isCallVisible, reduceCallView,
} from './state/callView.js';
export type {
  CallPhase,
  CallViewState,
  ConnectionStatus,
  RemoteParticipant,
  SelfState,
  SettledOutcome,
  ViewAction,
} from './state/callView.js';
export { settledText } from './state/participants.js';
export {
  blockedCopy, browserPermissionQuery, classifyProbeError, devicesFor, explanationCopy, needsExplanation,
} from './state/permissions.js';
export type { DeviceKind, PermissionFailure, PermissionQuery, PermissionStatus } from './state/permissions.js';

export { MAX_REMOTE_TILES, MAX_TILES, cellSide, focusedLayer, gridDimensions, tileLayer, visibleTiles } from './layout/grid.js';
export type { GridDimensions } from './layout/grid.js';
export {
  allCorners, clampOrigin, cornerOrigin, defaultPipCorner, isPipCorner, nearestCorner, pipSizeFor,
} from './layout/pip.js';
export type { PipCorner, PipPoint, PipSize } from './layout/pip.js';
export { useElementSize } from './useElementSize.js';

export { elapsedSec, formatDuration } from './format/duration.js';
export { endReasonText, endedHoldMs } from './format/endReason.js';
export { avatarGradient, avatarIndex, avatarInitial, fnv1a32 } from './format/avatar.js';

export { styles } from './styles.js';
export { avatarGradients, callColors, callFont, callMetrics, callMotion } from './theme.js';
