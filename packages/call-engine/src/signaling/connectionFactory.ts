import type { RtcError } from '../errors.js';
import type { ConnectionOptions } from './connection.js';
import { Connection } from './connection.js';
import type { WebSocketFactory } from './webSocket.js';

/**
 * 按 engine 需要的形状装配一条 `Connection`。
 *
 * 单拎出来是因为它有一处**只有类型系统会提醒、但很容易写错**的地方：
 * `exactOptionalPropertyTypes` 下，可选字段不能显式传 `undefined`，
 * 只能整个不写——于是 `webSocketFactory` 必须用展开语法条件性地加进去。
 * 那三行放在门面里既碍眼又容易在下次改动时被"顺手简化"掉。
 */
export interface EngineConnectionHandlers {
  onEvent: (type: string, data: Record<string, unknown>) => void;
  onDisconnected: (info: { code?: number; willReconnect: boolean }) => void;
  onKickedOut: () => void;
  onError: (error: RtcError) => void;
}

/** EngineConnectionConfig 是装配一条连接需要的最小信息。 */
export interface EngineConnectionConfig {
  url: string;
  token: string;
  deviceId: string;
  webSocketFactory?: WebSocketFactory;
}

/** createConnection 造一条已挂好回调、尚未连接的 Connection。 */
export function createConnection(
  config: EngineConnectionConfig,
  handlers: EngineConnectionHandlers,
): Connection {
  const options: ConnectionOptions = {
    url: config.url,
    token: config.token,
    deviceId: config.deviceId,
    // exactOptionalPropertyTypes：没有工厂时**不能传 undefined**，只能不写这个键。
    ...(config.webSocketFactory === undefined
      ? {}
      : { webSocketFactory: config.webSocketFactory }),
    events: {
      onEvent: (type, data): void => handlers.onEvent(type, data),
      onDisconnected: (info): void =>
        handlers.onDisconnected({ code: info.code, willReconnect: info.willReconnect }),
      onKickedOut: (): void => handlers.onKickedOut(),
      onError: (error): void => handlers.onError(error),
    },
  };
  return new Connection(options);
}
