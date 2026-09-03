import { ErrorCode, RtcError } from '../errors.js';
import { logger, redact } from '../logger.js';
import { backoffDelayMs } from './backoff.js';
import type { Envelope } from './envelope.js';
import { decodeEnvelope, encodeEnvelope, okType } from './envelope.js';
import { decodeFields, encodeFields } from './fieldSpec.js';
import type { FrameFields } from './fieldSpec.js';
import { HELLO_FIELDS, HELLO_OK_FIELDS } from './frames.sys.js';
import { FrameType, lookupFrame } from './registry.js';
import type { WebSocketFactory, WebSocketLike } from './webSocket.js';
import { CloseCode, WS_OPEN, browserWebSocketFactory, shouldReconnect } from './webSocket.js';

/**
 * 信令连接：握手、心跳、请求应答配对、退避重连。
 *
 * # 为什么按 req_id 配对而不是按帧类型
 *
 * pub 侧的 `room.offer` 是由 **`room.answer`** 应答的（协议 §3.3 固定 offerer），
 * 只看类型对不上号。按 req_id 配对还顺带解决了「多个同类请求在途」的问题。
 */

/** ConnectionState 是连接状态。 */
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

/** HelloOk 是握手成功后的服务端信息。 */
export interface HelloOk {
  uid: string;
  deviceId: string;
  sessionId: string;
  resumed: boolean;
  pingIntervalSec: number;
  limits: {
    maxFrameBytes: number;
    maxCallees: number;
    maxRoomParticipants: number;
    maxUserDataBytes: number;
    ringTimeoutSecDefault: number;
  };
}

/** ConnectionEvents 是连接层对外的回调。 */
export interface ConnectionEvents {
  /** 握手完成。resumed=true 表示恢复了旧会话，房间成员关系还在。 */
  onConnected?: (hello: HelloOk) => void;
  /** 连接断开。willReconnect=false 时不会再自动回来。 */
  onDisconnected?: (info: { code: number; reason: string; willReconnect: boolean }) => void;
  /** 被踢（同 uid 同 device_id 在别处登录）。 */
  onKickedOut?: () => void;
  /** 收到服务端主动推送的事件（req_id 为空的帧）。 */
  onEvent?: (type: string, data: Record<string, unknown>, envelope: Envelope) => void;
  /** 内部错误。 */
  onError?: (error: RtcError) => void;
}

/** ConnectionOptions 是构造参数。带 Fn 后缀的都是为了测试可注入。 */
export interface ConnectionOptions {
  url: string;
  token: string;
  deviceId: string;
  sdk?: string;
  events?: ConnectionEvents;
  webSocketFactory?: WebSocketFactory;
  /** 请求超时。协议建议 10 秒（§2.2）。 */
  requestTimeoutMs?: number;
  random?: () => number;
}

interface Pending {
  resolve: (value: { envelope: Envelope; data: Record<string, unknown> }) => void;
  reject: (reason: RtcError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const HEARTBEAT_MISS_LIMIT = 3;

/** Connection 是一条信令连接。断线会自动重连，除非关闭码明说不该重连。 */
export class Connection {
  private readonly options: Required<Omit<ConnectionOptions, 'events' | 'sdk'>> &
    Pick<ConnectionOptions, 'events' | 'sdk'>;

  private ws: WebSocketLike | null = null;
  private state: ConnectionState = 'idle';
  private sessionId = '';
  private seq = 0;
  private attempt = 0;
  private readonly pending = new Map<string, Pending>();

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private missedBeats = 0;
  private token: string;

  constructor(options: ConnectionOptions) {
    this.token = options.token;
    this.options = {
      url: options.url,
      token: options.token,
      deviceId: options.deviceId,
      sdk: options.sdk ?? 'web/0.0.1',
      events: options.events ?? {},
      webSocketFactory: options.webSocketFactory ?? browserWebSocketFactory,
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      random: options.random ?? Math.random,
    };
  }

  /** currentState 返回连接状态。 */
  get currentState(): ConnectionState {
    return this.state;
  }

  /** currentSessionId 返回会话 id；重连时会带上它请求恢复。 */
  get currentSessionId(): string {
    return this.sessionId;
  }

  /** updateToken 换一枚新的接入票（旧票过期时用）。下次连接生效。 */
  updateToken(token: string): void {
    this.token = token;
  }

  /** connect 建立连接并完成握手。已连上时直接返回。 */
  async connect(): Promise<HelloOk> {
    if (this.state === 'connected' && this.ws !== null) {
      throw new RtcError(ErrorCode.invalidState, { cause: new Error('已经连上了') });
    }
    this.state = this.sessionId === '' ? 'connecting' : 'reconnecting';
    const socket = this.options.webSocketFactory(this.options.url);
    this.ws = socket;

    await new Promise<void>((resolve, reject) => {
      socket.onopen = (): void => resolve();
      socket.onerror = (): void =>
        reject(new RtcError(ErrorCode.networkUnreachable, { cause: new Error('WebSocket 打开失败') }));
      socket.onclose = (event): void => this.handleClose(event);
    });

    socket.onmessage = (event): void => this.handleMessage(event.data);
    const hello = await this.handshake();

    this.state = 'connected';
    this.attempt = 0;
    this.startHeartbeat(hello.pingIntervalSec);
    this.options.events?.onConnected?.(hello);
    return hello;
  }

  /** close 主动关闭，**不会**触发重连。 */
  close(): void {
    this.state = 'closed';
    this.stopHeartbeat();
    this.clearReconnect();
    this.rejectAllPending(new RtcError(ErrorCode.invalidState, { cause: new Error('连接已关闭') }));
    this.ws?.close(CloseCode.normal, 'client logout');
    this.ws = null;
  }

  /**
   * request 发一个请求并等它的应答。
   *
   * 返回的 data 是**已按帧声明解码**的对象；未注册的应答类型返回原始 data。
   */
  async request(
    type: string,
    fields: FrameFields,
    value: Record<string, unknown>,
  ): Promise<{ envelope: Envelope; data: Record<string, unknown> }> {
    const socket = this.ws;
    if (socket === null || this.state !== 'connected') {
      throw new RtcError(ErrorCode.invalidState, {
        forType: type,
        cause: new Error(`连接不可用（当前 ${this.state}）`),
      });
    }
    const reqId = this.nextReqId();
    const raw = encodeEnvelope(type, reqId, encodeFields(fields, value as never));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new RtcError(ErrorCode.signalingTimeout, { forType: type }));
      }, this.options.requestTimeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });

      try {
        socket.send(raw);
      } catch (cause) {
        clearTimeout(timer);
        this.pending.delete(reqId);
        reject(new RtcError(ErrorCode.networkUnreachable, { forType: type, cause }));
      }
    });
  }

  /** send 发一帧但不等应答（服务端主动事件的回应，如 sub 的 answer）。 */
  sendFrame(type: string, reqId: string, fields: FrameFields, value: Record<string, unknown>): void {
    const socket = this.ws;
    if (socket === null || socket.readyState !== WS_OPEN) return;
    socket.send(encodeEnvelope(type, reqId, encodeFields(fields, value as never)));
  }

  private nextReqId(): string {
    this.seq += 1;
    return `w-${this.seq}`;
  }

  private async handshake(): Promise<HelloOk> {
    const hello = decodeFields(HELLO_FIELDS, {});
    hello.token = this.token;
    hello.deviceId = this.options.deviceId;
    hello.sessionId = this.sessionId;
    hello.sdk = this.options.sdk ?? 'web/0.0.1';

    logger.debug('发送 sys.hello', {
      deviceId: hello.deviceId,
      sessionId: hello.sessionId,
      // 凭据只打前 6 位 + 长度（CONVENTIONS §6）。
      token: redact(hello.token),
    });

    const { envelope, data } = await this.request(
      FrameType.hello,
      HELLO_FIELDS,
      hello as unknown as Record<string, unknown>,
    );
    if (envelope.type !== okType(FrameType.hello)) {
      throw new RtcError(ErrorCode.notAuthenticated, {
        cause: new Error(`握手应答是 ${envelope.type}`),
      });
    }
    const ok = decodeFields(HELLO_OK_FIELDS, encodeFields(HELLO_OK_FIELDS, data as never));
    this.sessionId = ok.sessionId;
    return ok as unknown as HelloOk;
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    this.missedBeats = 0;

    let envelope: Envelope;
    try {
      envelope = decodeEnvelope(raw);
    } catch (err) {
      // 解不开的帧是对端的实现 bug。抛给宿主并断开——继续读只会读到更多垃圾。
      this.emitError(err);
      this.ws?.close(CloseCode.badProtocol, 'undecodable frame');
      return;
    }

    if (envelope.reqId !== '' && this.settlePending(envelope)) return;
    this.dispatchEvent(envelope);
  }

  private settlePending(envelope: Envelope): boolean {
    const waiter = this.pending.get(envelope.reqId);
    if (waiter === undefined) return false;
    this.pending.delete(envelope.reqId);
    clearTimeout(waiter.timer);

    if (envelope.type === FrameType.error) {
      waiter.reject(this.toRtcError(envelope));
      return true;
    }
    waiter.resolve({ envelope, data: this.decodeData(envelope) });
    return true;
  }

  private dispatchEvent(envelope: Envelope): void {
    if (envelope.type === FrameType.error) {
      const error = this.toRtcError(envelope);
      if (error.code === ErrorCode.kickedOut) this.options.events?.onKickedOut?.();
      this.options.events?.onError?.(error);
      return;
    }
    if (lookupFrame(envelope.type) === undefined) {
      // §2.3：客户端收到未知 type **必须静默忽略**——服务端可能比我们新。
      logger.debug('忽略未知帧', { type: envelope.type });
      return;
    }
    this.options.events?.onEvent?.(envelope.type, this.decodeData(envelope), envelope);
  }

  private decodeData(envelope: Envelope): Record<string, unknown> {
    const fields = lookupFrame(envelope.type);
    if (fields === undefined) return { ...envelope.data };
    return decodeFields(fields, envelope.data) as unknown as Record<string, unknown>;
  }

  private toRtcError(envelope: Envelope): RtcError {
    const code = envelope.data['code'];
    return new RtcError(typeof code === 'number' ? code : ErrorCode.internal, {
      forType: typeof envelope.data['for_type'] === 'string' ? envelope.data['for_type'] : '',
    });
  }

  private handleClose(event: { code: number; reason: string }): void {
    this.stopHeartbeat();
    this.ws = null;
    this.rejectAllPending(
      new RtcError(ErrorCode.networkUnreachable, { cause: new Error('连接已断开') }),
    );

    if (event.code === CloseCode.kickedOut) this.options.events?.onKickedOut?.();

    const willReconnect = this.state !== 'closed' && shouldReconnect(event.code);
    this.options.events?.onDisconnected?.({
      code: event.code,
      reason: event.reason,
      willReconnect,
    });
    if (!willReconnect) {
      this.state = 'closed';
      return;
    }
    this.state = 'reconnecting';
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    const delay = backoffDelayMs(this.attempt, this.options.random);
    this.attempt += 1;
    logger.info('计划重连', { attempt: this.attempt, delayMs: delay, sessionId: this.sessionId });

    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch((err: unknown) => {
        this.emitError(err);
        if (this.state !== 'closed') this.scheduleReconnect();
      });
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * startHeartbeat 每 pingIntervalSec 发一个 sys.ping。
   *
   * 连续 3 个周期收不到对端**任何**帧就判死（§1.3）——不是「3 个 pong 没回来」，
   * 因为服务端的任何一帧都证明它还活着。
   */
  private startHeartbeat(pingIntervalSec: number): void {
    this.stopHeartbeat();
    this.missedBeats = 0;
    const intervalMs = Math.max(1, pingIntervalSec) * 1000;

    this.pingTimer = setInterval(() => {
      this.missedBeats += 1;
      if (this.missedBeats > HEARTBEAT_MISS_LIMIT) {
        logger.warn('心跳超时，判定连接已死', { missedBeats: this.missedBeats });
        this.ws?.close(CloseCode.goingAway, 'heartbeat timeout');
        return;
      }
      const socket = this.ws;
      if (socket !== null && socket.readyState === WS_OPEN) {
        socket.send(encodeEnvelope(FrameType.ping, this.nextReqId(), {}));
      }
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private rejectAllPending(error: RtcError): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }

  private emitError(err: unknown): void {
    const error =
      err instanceof RtcError ? err : new RtcError(ErrorCode.internal, { cause: err });
    this.options.events?.onError?.(error);
  }
}
