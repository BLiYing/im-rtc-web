import { ErrorCode, RtcError, errorName, isRtcError } from './errors.js';
import { EventBus } from './eventBus.js';
import type { EngineEventHandler, EngineEventName } from './events.js';
import { MACHINE_EVENT_NAMES } from './events.js';
import { logger } from './logger.js';
import type { MediaAdapter } from './media/mediaAdapter.js';
import { WebRTCAdapter } from './media/webrtcAdapter.js';
import type { HelloOk } from './signaling/connection.js';
import { Connection } from './signaling/connection.js';
import type { MediaType, PcRole } from './signaling/enums.js';
import { lookupFrame } from './signaling/registry.js';
import type { WebSocketFactory } from './signaling/webSocket.js';
import type { EngineContext } from './state/engineMachine.js';
import { initialEngineContext, reduceEngine } from './state/engineMachine.js';
import type { EmittedEvent, MachineInput, OutgoingFrame } from './state/types.js';

/**
 * CallEngine 是门面：把信令连接、状态机、媒体适配器接在一起。
 *
 * # 它自己不做决策
 *
 * 「现在能不能 accept」「该不该抛 onCallEnd」全在状态机里（那是纯逻辑，跑一致性向量）；
 * 「SDP 长什么样」全在媒体适配器里。门面只做三件事：**路由输入、填 SDP、派发事件**。
 *
 * # 为什么门面要填 SDP
 *
 * 状态机是纯的，产不出 SDP。所以它产出的协商帧是**意图**——`sdp` 字段留空，
 * 由门面从媒体适配器取真值填进去再发。这条边界让状态机能在 Node 里被完整测试。
 */

/** EngineOptions 是构造参数。 */
export interface EngineOptions {
  /** 信令地址，如 `wss://rtc.example.com/v1/ws`。 */
  url: string;
  deviceId: string;
  /** 媒体适配器。默认用浏览器 WebRTC；测试可注入假实现。 */
  media?: MediaAdapter;
  /** WebSocket 工厂。默认用浏览器原生；测试可注入假实现。 */
  webSocketFactory?: WebSocketFactory;
}

/** CallEngine 是宿主唯一需要接触的类型。 */
export class CallEngine {
  private readonly bus = new EventBus();
  private readonly media: MediaAdapter;
  private readonly options: EngineOptions;

  private connection: Connection | null = null;
  private ctx: EngineContext = initialEngineContext;
  /** 服务端最近一次下发的 sub offer，答复时要用。 */
  private lastSubOfferSdp = '';
  /** 已经抛过 firstVideoFrame 的轨道，避免重复抛。 */
  private readonly seenVideo = new Set<string>();

  constructor(options: EngineOptions) {
    this.options = options;
    this.media = options.media ?? new WebRTCAdapter();
  }

  /** on 订阅事件，返回退订函数。事件表见 events.ts（= 设计文档 §7.5）。 */
  on<K extends EngineEventName>(name: K, handler: EngineEventHandler<K>): () => void {
    return this.bus.on(name, handler);
  }

  /** state 返回当前的通话与房间状态，供 UI 渲染。 */
  get state(): EngineContext {
    return this.ctx;
  }

  /** login 建立信令连接并完成握手。 */
  async login(token: string): Promise<HelloOk> {
    const connection = new Connection({
      url: this.options.url,
      token,
      deviceId: this.options.deviceId,
      ...(this.options.webSocketFactory === undefined
        ? {}
        : { webSocketFactory: this.options.webSocketFactory }),
      events: {
        onEvent: (type, data): void => {
          void this.handleIncoming(type, data);
        },
        onDisconnected: (info): void => {
          void this.dispatch({ kind: 'internal', name: 'disconnected' });
          this.bus.emit('disconnected', { code: info.code, willReconnect: info.willReconnect });
        },
        onKickedOut: (): void => {
          void this.dispatch({ kind: 'internal', name: 'ws_closed_4403' });
        },
        onError: (error): void => this.emitError(error),
      },
    });
    this.connection = connection;
    this.media.open({
      onLocalCandidate: (pc, candidate): void => this.sendCandidate(pc, candidate),
      onRemoteTrack: (trackId, track): void => this.onRemoteTrack(trackId, track),
      onConnectionStateChange: (pc, state): void => this.onPcState(pc, state),
    });

    const hello = await connection.connect();
    await this.dispatch({
      kind: 'recv',
      type: 'sys.hello.ok',
      data: { session_id: hello.sessionId, resumed: hello.resumed },
    });
    return hello;
  }

  /** logout 关掉连接与媒体。 */
  logout(): void {
    this.connection?.close();
    this.connection = null;
    this.media.close();
    this.seenVideo.clear();
    this.ctx = initialEngineContext;
  }

  /** call 发起通话。 */
  async call(calleeIds: string[], mediaType: MediaType, isGroup = false): Promise<void> {
    await this.dispatch({
      kind: 'act',
      op: 'call',
      args: { callee_ids: calleeIds, media_type: mediaType, is_group: isGroup },
    });
  }

  /** accept 接听。 */
  async accept(): Promise<void> {
    await this.dispatch({ kind: 'act', op: 'accept' });
  }

  /** reject 拒接。 */
  async reject(): Promise<void> {
    await this.dispatch({ kind: 'act', op: 'reject' });
  }

  /** cancel 取消呼出（**仅接通前**；接通后用 hangup）。 */
  async cancel(): Promise<void> {
    await this.dispatch({ kind: 'act', op: 'cancel' });
  }

  /** hangup 挂断（接通后，主被叫都用它）。 */
  async hangup(): Promise<void> {
    await this.dispatch({ kind: 'act', op: 'hangup' });
  }

  /** joinRoom 直接进一个会议房（不走振铃）。 */
  async joinRoom(roomId: string, roomToken: string, autoSubscribe = true): Promise<void> {
    await this.dispatch({
      kind: 'act',
      op: 'join',
      args: { room_id: roomId, room_token: roomToken, auto_subscribe: autoSubscribe },
    });
  }

  /** leaveRoom 离房。 */
  async leaveRoom(): Promise<void> {
    await this.dispatch({ kind: 'act', op: 'leave' });
  }

  /**
   * publishMicrophone 发布麦克风。
   *
   * 顺序是**先拿轨道再拿 cid**：浏览器不允许自定义 track.id，而服务端靠
   * msid 里的 cid 认领 m-line（协议 §3.2）。
   */
  async publishMicrophone(): Promise<string> {
    const info = await this.media.acquireMicrophone();
    await this.dispatch({
      kind: 'act',
      op: 'publish',
      args: { cid: info.cid, kind: info.kind, source: info.source, simulcast: false },
    });
    return info.cid;
  }

  /** publishCamera 发布摄像头。 */
  async publishCamera(simulcast = true): Promise<string> {
    const info = await this.media.acquireCamera();
    await this.dispatch({
      kind: 'act',
      op: 'publish',
      args: { cid: info.cid, kind: info.kind, source: info.source, simulcast },
    });
    return info.cid;
  }

  /** setMuted 开关本端某条轨道。**不是 unpublish**，协商保留。 */
  async setMuted(cid: string, muted: boolean): Promise<void> {
    this.media.setMuted(cid, muted);
    const trackId = this.ctx.room.publishTrackIds[cid];
    if (trackId === undefined) return;
    await this.dispatch({ kind: 'act', op: 'mute', args: { track_id: trackId, muted } });
  }

  /** localTrack 取本端轨道做预览。 */
  localTrack(cid: string): MediaStreamTrack | undefined {
    return this.media.localTrack(cid);
  }

  // ── 内部 ──────────────────────────────────────────────

  /**
   * handleIncoming 是**所有下行帧的唯一入口**——事件与应答都走它。
   *
   * 这里曾经漏了应答那一半：`.ok` 走的是 `request()` 的 Promise，没喂回状态机，
   * 于是 `room.join` 发出去了、`room.join.ok` 回来了，房间状态却永远停在 `joining`，
   * 随后的 publish 全被 R1「只有 joined 才允许发布」本地拒掉。
   */
  private async handleIncoming(type: string, data: Record<string, unknown>): Promise<void> {
    if (type === 'room.offer' && data['pc'] === 'sub') {
      this.lastSubOfferSdp = typeof data['sdp'] === 'string' ? data['sdp'] : '';
    }
    if (type === 'room.answer' && data['pc'] === 'pub') {
      // 先把 SDP 应用到媒体层，再让状态机把发布状态推进到 published。
      await this.media.applyPubAnswer(typeof data['sdp'] === 'string' ? data['sdp'] : '');
    }
    await this.dispatch({ kind: 'recv', type, data });
  }

  /** dispatch 把一个输入喂进状态机，然后发帧、抛事件。 */
  private async dispatch(input: MachineInput): Promise<void> {
    const result = reduceEngine(this.ctx, input);
    this.ctx = result.state;

    for (const frame of result.send) {
      await this.sendFrame(frame);
    }
    for (const event of result.emit) {
      this.emitMachineEvent(event);
    }
  }

  /** sendFrame 发一帧；协商帧的 sdp 在这里从媒体适配器填入。 */
  private async sendFrame(frame: OutgoingFrame): Promise<void> {
    const connection = this.connection;
    if (connection === null) return;

    const fields = lookupFrame(frame.type);
    if (fields === undefined) return;

    const data: Record<string, unknown> = { ...frame.data };
    try {
      if (frame.type === 'room.offer' && data['pc'] === 'pub') {
        data['sdp'] = await this.media.createPubOffer();
      } else if (frame.type === 'room.answer' && data['pc'] === 'sub') {
        data['sdp'] = await this.media.answerSubOffer(this.lastSubOfferSdp);
      }
      const reply = await connection.request(frame.type, fields, toCamel(fields, data));
      // **应答也要喂回状态机**：join.ok / publish.ok 都是状态推进的关键一步。
      await this.handleIncoming(reply.envelope.type, reply.data);
    } catch (err) {
      // 请求失败不该中断整个事件流：转成 error 事件交给宿主。
      this.emitError(err);
    }
  }

  private sendCandidate(pc: PcRole, candidate: RTCIceCandidateInit): void {
    const connection = this.connection;
    const fields = lookupFrame('room.ice_candidate');
    if (connection === null || fields === undefined) return;
    void connection
      .request('room.ice_candidate', fields, {
        pc,
        candidate: candidate.candidate ?? '',
        sdpMid: candidate.sdpMid ?? '',
        sdpMLineIndex: candidate.sdpMLineIndex ?? 0,
      })
      .catch((err: unknown) => this.emitError(err));
  }

  private onRemoteTrack(trackId: string, track: MediaStreamTrack): void {
    this.bus.emit('remoteTrack', { trackId, track });
    if (track.kind !== 'video' || this.seenVideo.has(trackId)) return;
    this.seenVideo.add(trackId);
    const uid = this.ctx.room.remoteTracks[trackId]?.uid ?? '';
    // firstVideoFrame 没有对应的信令帧——它是本地事件，UI 用来撤 loading。
    this.bus.emit('firstVideoFrame', { uid, trackId });
  }

  private onPcState(pc: PcRole, state: RTCPeerConnectionState): void {
    logger.debug('PC 状态', { pc, state });
    if (pc === 'sub' && state === 'connected') {
      void this.dispatch({ kind: 'internal', name: 'media_ready' });
    }
  }

  /** emitMachineEvent 把状态机的 onXxx 翻成公开事件名，并把参数转成 camelCase。 */
  private emitMachineEvent(event: EmittedEvent): void {
    const name = MACHINE_EVENT_NAMES[event.cb];
    if (name === undefined) {
      logger.warn('状态机抛了一个没登记的回调', { cb: event.cb });
      return;
    }
    // 参数从协议的 snake_case 转成 TS 惯用的 camelCase。
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.args)) {
      payload[snakeToCamel(key)] = value;
    }
    this.bus.emit(name, payload as never);
  }

  private emitError(err: unknown): void {
    const error = isRtcError(err) ? err : new RtcError(ErrorCode.internal, { cause: err });
    this.bus.emit('error', {
      code: error.code,
      name: errorName(error.code),
      message: error.message,
    });
  }
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

/** toCamel 把线路形状的 data 转成字段声明用的 camelCase 属性名。 */
function toCamel(
  fields: Readonly<Record<string, { wire: string }>>,
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [prop, spec] of Object.entries(fields)) {
    if (Object.hasOwn(data, spec.wire)) out[prop] = data[spec.wire];
    else if (Object.hasOwn(data, prop)) out[prop] = data[prop];
  }
  return out;
}
