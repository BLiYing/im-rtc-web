/**
 * `@im-rtc/call-engine` —— im-rtc 的无 UI 核心。
 *
 * **框架无关**：本包禁止依赖 react 或任何 UI 库，且必须能在无 DOM 的环境构造
 * （一致性向量测试就跑在 Node 里）。DOM / WebRTC 的接触点收敛在 media/ 与 devices/。
 *
 * **协议契约在 `im-rtc-server/docs/RTC_PROTOCOL.md`，本仓只读引用**——
 * 不得单方面加字段。改协议 = 改四个仓 + 同步一致性向量。
 *
 * 当前进度（P2 第一刀）：信令帧的编解码与协议常量。
 * 状态机、WS 客户端、媒体适配器随后落地。
 */

export {
  ERROR_DEFINITIONS,
  ErrorCode,
  RtcError,
  errorName,
  isLocalError,
  isRetryable,
  isRtcError,
  lookupError,
} from './errors.js';
export type { ErrorCodeName, ErrorCodeValue, ErrorDefinition } from './errors.js';

export {
  CallEndReason,
  GROUP_DOMINANT_PRIORITY,
  callDurationSec,
  dominantReason,
  normalizeReason,
} from './reasons.js';
export type { CallEndReasonValue } from './reasons.js';

export {
  LogField,
  clearDiagnostics,
  exportDiagnostics,
  logger,
  redact,
  redactCandidate,
  redactSdp,
  setLogClock,
  setLogLevel,
  setLogSink,
} from './logger.js';
export type { DiagnosticEntry, LogFields, LogLevel, LogSink } from './logger.js';

export {
  MAX_FRAME_BYTES,
  OK_SUFFIX,
  decodeEnvelope,
  encodeEnvelope,
  isEvent,
  okType,
} from './signaling/envelope.js';
export type { Envelope } from './signaling/envelope.js';

export { checkDiscipline } from './signaling/discipline.js';

export {
  DEFAULT_TIMEOUT_SEC,
  LAYERS,
  MAX_TIMEOUT_SEC,
  MEDIA_TYPES,
  MIN_TIMEOUT_SEC,
  PC_ROLES,
  REASONS,
  ROOM_KINDS,
  TRACK_KINDS,
  TRACK_SOURCES,
} from './signaling/enums.js';
export type {
  HandledAction,
  Layer,
  MediaType,
  PcRole,
  RoomKind,
  TrackKind,
  TrackSource,
} from './signaling/enums.js';

export {
  FrameType,
  REQUEST_TYPES,
  RESERVED_TYPES,
  decodeFrame,
  encodeFrame,
  isRequestType,
  isReservedType,
  knownFrameTypes,
  lookupFrame,
  newFrameData,
} from './signaling/registry.js';

export type { FieldSpec, FrameData, FrameFields } from './signaling/fieldSpec.js';

export { BACKOFF_STEPS_MS, backoffDelayMs } from './signaling/backoff.js';
export { CloseCode, shouldReconnect } from './signaling/webSocket.js';
export type { WebSocketFactory, WebSocketLike } from './signaling/webSocket.js';
export { Connection } from './signaling/connection.js';
export type { ConnectionEvents, ConnectionOptions, ConnectionState, HelloOk } from './signaling/connection.js';

export { initialCallContext, reduceCall, synthesizeNetworkEnd } from './state/callMachine.js';
export type { CallContext, CallRole, CallState } from './state/callMachine.js';
export { initialRoomContext, reduceRoom, resumeRoom } from './state/roomMachine.js';
export type { PublishState, RoomContext, RoomState, SubscribeState } from './state/roomMachine.js';
export { initialEngineContext, reduceEngine } from './state/engineMachine.js';
export type { EngineContext } from './state/engineMachine.js';
export type { EmittedEvent, MachineInput, MachineOutput, OutgoingFrame } from './state/types.js';

export { CallEngine } from './engine.js';
export type { EngineOptions } from './engine.js';
export { EventBus } from './eventBus.js';
export { EngineBus } from './engineBus.js';
export { MACHINE_EVENT_NAMES } from './events.js';
export type { CallRoleName, EngineEventHandler, EngineEventName, EngineEvents } from './events.js';
export { WebRTCAdapter } from './media/webrtcAdapter.js';
export { VideoProfiles, defaultVideoProfile, videoConstraints } from './media/videoProfile.js';
export type { VideoProfile } from './media/videoProfile.js';
export { ViewRegistry } from './media/viewRegistry.js';
export { MediaBridge } from './media/mediaBridge.js';
export type { ViewElement } from './media/viewRegistry.js';
export { camelizeArgs, snakeToCamel, toFrameProps } from './signaling/caseMapping.js';
export { FrameSender } from './signaling/frameSender.js';
export { parseCandidate } from './signaling/candidate.js';
export { createConnection } from './signaling/connectionFactory.js';
export type { ParsedCandidate } from './signaling/candidate.js';
export type {
  LocalTrackInfo,
  MediaAdapter,
  MediaAdapterEvents,
  MediaSource,
} from './media/mediaAdapter.js';

export * as frames from './signaling/frames.room.js';
