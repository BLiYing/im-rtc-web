import { ErrorCode, RtcError } from '../errors.js';
import { logger, redact } from '../logger.js';
import type { Envelope } from './envelope.js';
import { decodeEnvelope, encodeEnvelope, okType } from './envelope.js';
import { decodeFields, encodeFields } from './fieldSpec.js';
import type { FrameFields } from './fieldSpec.js';
import { HELLO_FIELDS, HELLO_OK_FIELDS } from './frames.sys.js';
import { Heartbeat } from './heartbeat.js';
import { PendingRequests } from './pendingRequests.js';
import { Reconnector } from './reconnector.js';
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

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * MAX_AUTH_FAILURES 是连续几次 4401 之后彻底放弃（协议 §1.5 关闭码表）。
 *
 * **一定要有这个上限**：4401 说的是「这枚 token 不好使」，而重连**带的是同一枚
 * token**——没有上限就是拿同一把坏钥匙永远敲同一扇门。实测里服务端重启换了签名密钥，
 * 一个没关的标签页重试到第 19 次还在敲，日志里全是 `token_invalid`，
 * 把真正的问题淹掉了。上限到了就抛 `onKickedOut` 把宿主赶回登录页去换新 token。
 */
const MAX_AUTH_FAILURES = 3;

/** Connection 是一条信令连接。断线会自动重连，除非关闭码明说不该重连。 */
export class Connection {
  private readonly options: Required<Omit<ConnectionOptions, 'events' | 'sdk'>> &
    Pick<ConnectionOptions, 'events' | 'sdk'>;

  private ws: WebSocketLike | null = null;
  private state: ConnectionState = 'idle';
  private sessionId = '';
  private seq = 0;
  private readonly pending: PendingRequests;

  private readonly heartbeat: Heartbeat;
  private readonly reconnector: Reconnector;
  private token: string;
  /** 连续鉴权失败次数。握手一成功就清零——只有**连续**失败才说明票是死的。 */
  private authFailures = 0;

  constructor(options: ConnectionOptions) {
    this.token = options.token;
    this.heartbeat = new Heartbeat({
      sendPing: (): void => this.sendPing(),
      onDead: (): void => this.ws?.close(CloseCode.goingAway, 'heartbeat timeout'),
    });
    this.pending = new PendingRequests(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    this.reconnector = new Reconnector(
      async (): Promise<void> => {
        await this.connect();
      },
      (err: unknown): void => this.emitError(err),
      options.random ?? Math.random,
    );
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

  /**
   * updateToken 换一枚新的接入票（旧票过期时用）。下次连接生效。
   *
   * **顺带把鉴权失败计数清零**：换票就是「这次不一样了」的唯一信号，
   * 不清的话已经用光重试次数的连接换了新票也再没有机会试。
   */
  updateToken(token: string): void {
    this.token = token;
    this.authFailures = 0;
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
    this.authFailures = 0;
    this.reconnector.succeeded();
    this.heartbeat.start(hello.pingIntervalSec);
    this.options.events?.onConnected?.(hello);
    return hello;
  }

  /** close 主动关闭，**不会**触发重连。 */
  close(): void {
    this.state = 'closed';
    this.heartbeat.stop();
    this.reconnector.stop();
    this.pending.rejectAll(new RtcError(ErrorCode.invalidState, { cause: new Error('连接已关闭') }));
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
    if (this.state !== 'connected') {
      throw new RtcError(ErrorCode.invalidState, {
        forType: type,
        cause: new Error(`连接不可用（当前 ${this.state}）`),
      });
    }
    return this.dispatchRequest(type, fields, value);
  }

  /**
   * dispatchRequest 不检查连接状态。
   *
   * 独立出来是因为 **sys.hello 本身就要在 connecting 状态下发出去**——
   * 让握手走公开的 request() 会被状态检查挡住（踩过一次：所有时序测试都挂在
   * 「一帧都没发出去」）。
   */
  private async dispatchRequest(
    type: string,
    fields: FrameFields,
    value: Record<string, unknown>,
  ): Promise<{ envelope: Envelope; data: Record<string, unknown> }> {
    const socket = this.ws;
    if (socket === null) {
      throw new RtcError(ErrorCode.invalidState, {
        forType: type,
        cause: new Error('还没有连接'),
      });
    }
    const reqId = this.nextReqId();
    const raw = encodeEnvelope(type, reqId, encodeFields(fields, value as never));
    const waiting = this.pending.track(reqId, type);

    try {
      socket.send(raw);
    } catch (cause) {
      this.pending.abandon(reqId);
      throw new RtcError(ErrorCode.networkUnreachable, { forType: type, cause });
    }
    return waiting;
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

    const { envelope, data } = await this.dispatchRequest(
      FrameType.hello,
      HELLO_FIELDS,
      hello as unknown as Record<string, unknown>,
    );
    if (envelope.type !== okType(FrameType.hello)) {
      throw new RtcError(ErrorCode.notAuthenticated, {
        cause: new Error(`握手应答是 ${envelope.type}`),
      });
    }
    // data 已经是线路形状（见 decodeData 的注释），直接解成 camelCase 给调用方。
    const ok = decodeFields(HELLO_OK_FIELDS, data);
    this.sessionId = ok.sessionId;
    return ok as unknown as HelloOk;
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    // 收到**任何**帧都算对端活着，不只是 pong（§1.3）。
    this.heartbeat.noteFrameReceived();

    let envelope: Envelope;
    try {
      envelope = decodeEnvelope(raw);
    } catch (err) {
      // 解不开的帧是对端的实现 bug。抛给宿主并断开——继续读只会读到更多垃圾。
      this.emitError(err);
      this.ws?.close(CloseCode.badProtocol, 'undecodable frame');
      return;
    }

    if (envelope.reqId !== '' && this.pending.settle(envelope, (e) => this.decodeData(e))) return;
    this.dispatchEvent(envelope);
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

  /**
   * decodeData 返回**线路形状**（snake_case）的规范化 data。
   *
   * 「解出来再编回去」看着多余，其实是在做三件事：填默认值、枚举兜底、数值钳制。
   * 保持 snake_case 是因为**状态机吃的是线路形状**——它跑的一致性向量就是线路形状，
   * 换成 camelCase 会让状态机与向量之间多一层翻译，而那层翻译没人测。
   */
  private decodeData(envelope: Envelope): Record<string, unknown> {
    const fields = lookupFrame(envelope.type);
    if (fields === undefined) return { ...envelope.data };
    return encodeFields(fields, decodeFields(fields, envelope.data));
  }

  private toRtcError(envelope: Envelope): RtcError {
    const code = envelope.data['code'];
    return new RtcError(typeof code === 'number' ? code : ErrorCode.internal, {
      forType: typeof envelope.data['for_type'] === 'string' ? envelope.data['for_type'] : '',
    });
  }

  private handleClose(event: { code: number; reason: string }): void {
    this.heartbeat.stop();
    this.ws = null;
    this.pending.rejectAll(
      new RtcError(ErrorCode.networkUnreachable, { cause: new Error('连接已断开') }),
    );

    if (event.code === CloseCode.kickedOut) this.options.events?.onKickedOut?.();

    /*
      4401 要计数。重连**带的是同一枚 token**，所以「换新 token 后重连」这条规则
      只有配上一个上限才成立——否则一枚废票能自己重试到天荒地老。
      连续 3 次之后按协议 §1.5 抛 onKickedOut，让宿主回登录页重新取票。
    */
    let exhausted = false;
    if (event.code === CloseCode.unauthorized) {
      this.authFailures += 1;
      exhausted = this.authFailures >= MAX_AUTH_FAILURES;
      if (exhausted) {
        logger.info('鉴权连续失败，停止重连', { failures: this.authFailures });
        this.reconnector.stop();
        this.options.events?.onKickedOut?.();
      }
    }

    const willReconnect = !exhausted && this.state !== 'closed' && shouldReconnect(event.code);
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
    this.reconnector.schedule();
  }

  /** sendPing 发一个心跳帧。连接不可用时静默跳过——心跳失败自有判死逻辑接手。 */
  private sendPing(): void {
    const socket = this.ws;
    if (socket !== null && socket.readyState === WS_OPEN) {
      socket.send(encodeEnvelope(FrameType.ping, this.nextReqId(), {}));
    }
  }

  private emitError(err: unknown): void {
    const error =
      err instanceof RtcError ? err : new RtcError(ErrorCode.internal, { cause: err });
    this.options.events?.onError?.(error);
  }
}
