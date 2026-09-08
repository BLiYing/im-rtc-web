import { ErrorCode, RtcError, rtcErrorFromWire } from '../errors.js';
import { logger, redact } from '../logger.js';
import type { Envelope } from './envelope.js';
import { decodeEnvelope, encodeEnvelope, okType } from './envelope.js';
import { decodeFields, encodeFields } from './fieldSpec.js';
import type { FrameFields } from './fieldSpec.js';
import { HELLO_FIELDS, HELLO_OK_FIELDS } from './frames.sys.js';
import type { ConnectionOptions, ConnectionState, HelloOk } from './connectionTypes.js';
import { TokenExpiryTimer } from './tokenExpiry.js';
import { handshakeGiveUpReason } from './handshakeGiveUp.js';
import { Heartbeat } from './heartbeat.js';
import { PendingRequests } from './pendingRequests.js';
import { Reconnector } from './reconnector.js';
import { ResumeDeadline } from './resumeDeadline.js';
import { FrameType, lookupFrame } from './registry.js';
import type { WebSocketLike } from './webSocket.js';
import { CloseCode, WS_OPEN, browserWebSocketFactory, shouldReconnect } from './webSocket.js';

/**
 * 信令连接：握手、心跳、请求应答配对、退避重连。
 *
 * # 为什么按 req_id 配对而不是按帧类型
 *
 * pub 侧的 `room.offer` 是由 **`room.answer`** 应答的（协议 §3.3 固定 offerer），
 * 只看类型对不上号。按 req_id 配对还顺带解决了「多个同类请求在途」的问题。
 */

export type {
  ConnectionState,
  HelloOk,
  KickedOutReason,
  ConnectionEvents,
  ConnectionOptions,
} from './connectionTypes.js';

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
  private readonly options: Required<Omit<ConnectionOptions, 'events' | 'sdk' | 'tokenExpiryLeadMs'>> &
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
  private readonly tokenExpiry: TokenExpiryTimer;
  /** 「服务端已经彻底放弃这条会话」的倒计时。见 `ResumeDeadline`。 */
  private readonly resumeDeadline: ResumeDeadline;

  constructor(options: ConnectionOptions) {
    this.token = options.token;
    this.heartbeat = new Heartbeat({
      sendPing: (): void => this.sendPing(),
      onDead: (): void => this.ws?.close(CloseCode.goingAway, 'heartbeat timeout'),
    });
    this.pending = new PendingRequests(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    this.tokenExpiry = new TokenExpiryTimer({
      ...(options.tokenExpiryLeadMs === undefined ? {} : { leadMs: options.tokenExpiryLeadMs }),
      onWillExpire: (info): void => this.options.events?.onTokenWillExpire?.(info),
    });
    this.resumeDeadline = new ResumeDeadline((): void => {
      this.sessionId = ''; // 服务端已经丢掉它，再拿去要 resume 只会白跑一趟
      this.options.events?.onSessionUnrecoverable?.();
    });
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
  updateToken(token: string, expiresAtMs?: number): void {
    this.token = token;
    this.authFailures = 0;
    // 宿主刚从自家后台拿到票，必然知道它的 expires_in。传了就按新票重新武装；
    // 不传就让旧定时器继续跑到下一次握手——那时 sys.hello.ok 会给出权威值。
    if (expiresAtMs !== undefined) this.tokenExpiry.arm(expiresAtMs);
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
    this.resumeDeadline.connected(hello.pingIntervalSec);
    this.heartbeat.start(hello.pingIntervalSec);
    this.tokenExpiry.arm(hello.tokenExpiresAtMs);
    this.options.events?.onConnected?.(hello);
    return hello;
  }

  /** close 主动关闭，**不会**触发重连。 */
  close(): void {
    this.state = 'closed';
    this.heartbeat.stop();
    this.reconnector.stop();
    // **只有 logout 撤这条倒计时**：鉴权连续失败那条路要让它走完（见 ResumeDeadline）。
    this.resumeDeadline.cancel();
    this.tokenExpiry.disarm();
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

    let reply: { envelope: Envelope; data: Record<string, unknown> };
    try {
      reply = await this.dispatchRequest(
        FrameType.hello,
        HELLO_FIELDS,
        hello as unknown as Record<string, unknown>,
      );
    } catch (err) {
      this.abortIfHandshakeRejected(err);
      throw err;
    }
    const { envelope, data } = reply;
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

  /**
   * 握手被拒且重试不可能变好时，一次就放弃，按 {@link handshakeGiveUpReason} 的分类抛给宿主。
   *
   * **握手应答类型不对那条不走这里**——那是对端的实现 bug，处置另说，
   * 不该借这条路悄悄改掉。
   */
  private abortIfHandshakeRejected(err: unknown): void {
    const reason = handshakeGiveUpReason(err);
    if (reason === null) return;
    const rtc = err as RtcError;
    logger.error('握手被拒，不再重连', { code: rtc.code, name: rtc.name_, reason });
    // stop() 是闩不是取消：connect() 被拒那条是微任务，排在 close 事件之后，
    // 只取消定时器的话它会把重连又排回来（见 Reconnector.stop 的注释）。
    this.reconnector.stop();
    this.state = 'closed';
    this.options.events?.onKickedOut?.({ reason });
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
      const error = rtcErrorFromWire(envelope.data);
      if (error.code === ErrorCode.kickedOut) this.options.events?.onKickedOut?.({ reason: 'takenOver' });
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
   *
   * # 解不动就按原始 data 放行，**绝不往上抛**
   *
   * 这里原先是裸的 `decodeFields`。字段类型对不上（服务端把 int 位置发成了字符串）时它抛
   * `bad_params`，而调用点在 `PendingRequests.settle` 里——那时 waiter **已经被摘掉、
   * 超时也已经清掉**，`resolve` 却还没执行：那个 `request()` 的 promise 从此永远不落定。
   * 症状是 `room.join.ok` 明明回来了，房间机却永远停在 `joining`，之后每次 publish 被
   * R1 拒成 2005，而宿主一条错误都收不到（异常从 `onmessage` 里冲出去成了未捕获错误）。
   * iOS（`(try? decodedData()) ?? envelope.data`）与 Android（catch 后回退 `envelope.data`）
   * 本来就是这么做的，本端是四端里唯一漏掉兜底的。
   *
   * 回退之后字段读取一律走 `Wire.*` 那套「读不出来就取零值」的取数器，状态机不会崩；
   * 真正的原因进日志 + 一条 error 事件，不塞进应答里让业务分不清。
   */
  private decodeData(envelope: Envelope): Record<string, unknown> {
    const fields = lookupFrame(envelope.type);
    if (fields === undefined) return { ...envelope.data };
    try {
      return encodeFields(fields, decodeFields(fields, envelope.data));
    } catch (err) {
      logger.warn('帧解码失败，按原始 data 放行', { type: envelope.type, cause: String(err) });
      this.emitError(err);
      return { ...envelope.data };
    }
  }

  private handleClose(event: { code: number; reason: string }): void {
    this.heartbeat.stop();
    this.ws = null;
    this.pending.rejectAll(
      new RtcError(ErrorCode.networkUnreachable, { cause: new Error('连接已断开') }),
    );

    if (event.code === CloseCode.kickedOut) this.options.events?.onKickedOut?.({ reason: 'takenOver' });

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
        this.options.events?.onKickedOut?.({ reason: 'authExpired' });
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
    this.resumeDeadline.arm();
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
