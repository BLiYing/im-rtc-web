import type { CallEngine, EngineEventName, EngineEvents, Layer, MediaType } from 'im-rtc-call-engine';

/**
 * FakeEngine 是 uikit 用到的那一小片 engine 接口。
 *
 * **它同时是一份清单**：uikit 只碰下面这些方法，一个私有通道都没有。
 * 哪天这个假实现要加一个新方法，就说明 uikit 伸手伸到了公开事件表之外——
 * 那时该补的是回调表，不是这个文件。
 */
/** FakeCallOptions 镜像 `CallEngine.call()` 的第三个参数形状，测试文件里不必再引 engine 包的类型。 */
type FakeCallOptions =
  | boolean
  | { isGroup?: boolean; chatGroupId?: string; userData?: string; timeoutSec?: number }
  | undefined;

export class FakeEngine {
  readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  readonly attached: { uid: string; hasElement: boolean }[] = [];
  readonly layers: { uid: string; layer: Layer }[] = [];
  readonly calls: string[] = [];
  /** `call.state` 由 `joinCall` 推进：`useCallActions.joinCall` 以它判定加入是否被拒。 */
  state = { room: { publishTrackIds: {} as Record<string, string> }, call: { state: 'idle' as string } };
  /** 本端 uid。`subscribeEngine` 用它把自己从 callee_ids 里剔掉。 */
  uid = 'me';

  on<K extends EngineEventName>(name: K, handler: (payload: EngineEvents[K]) => void): () => void {
    const set = this.handlers.get(name) ?? new Set();
    // 这里的两次断言是把「按事件名分发」这件事从类型系统里放出来；
    // 真 engine 用的是同样的模式（EventBus），断言范围仅限本文件。
    set.add(handler as (payload: unknown) => void);
    this.handlers.set(name, set);
    return () => set.delete(handler as (payload: unknown) => void);
  }

  /** emit 让测试代替服务端抛一个事件。 */
  emit<K extends EngineEventName>(name: K, payload: EngineEvents[K]): void {
    for (const handler of this.handlers.get(name) ?? []) handler(payload);
  }

  /** listenerCount 是「订阅有没有清干净」的直接证据。 */
  listenerCount(): number {
    let total = 0;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }

  attachView(uid: string, el: unknown): void {
    this.attached.push({ uid, hasElement: el !== null });
  }

  attachLocalView(cid: string, el: unknown): void {
    this.attached.push({ uid: `:local:${cid}`, hasElement: el !== null });
  }

  async setRemoteLayer(uid: string, layer: Layer): Promise<void> {
    this.layers.push({ uid, layer });
  }

  /** 记录最近一次 call() 的 options，供测试断言 chatGroupId / userData 真的传到了 engine 这一层。 */
  lastCallOptions: FakeCallOptions = undefined;
  async call(calleeIds: string[], mediaType: MediaType, options?: FakeCallOptions): Promise<void> {
    this.calls.push(`call:${calleeIds.join(',')}:${mediaType}`);
    this.lastCallOptions = options;
  }
  async accept(): Promise<void> {
    this.calls.push('accept');
  }
  async reject(): Promise<void> {
    this.calls.push('reject');
  }
  async cancel(): Promise<void> {
    this.calls.push('cancel');
  }
  async hangup(): Promise<void> {
    this.calls.push('hangup');
  }
  forceEnd(): void {
    this.calls.push('forceEnd');
  }
  /**
   * `inviteMoreError` 只用来测「万一它意外抛出」的兜底路径（`useCallActions.inviteMore`
   * 的 `try/catch` 就是为这个留的）。**真 engine 的 `inviteMore` 从不为服务端拒绝
   * （1202 / 1407 / 1409）抛异常**——那些都经 `error` 事件到达（`FrameLoop.sendFrame`
   * 同 `joinCallError` 那段注释的道理），测服务端拒绝请直接 `engine.emit('error', …)`。
   */
  inviteMoreError: unknown = null;
  async inviteMore(calleeIds: string[]): Promise<void> {
    this.calls.push(`inviteMore:${calleeIds.join(',')}`);
    if (this.inviteMoreError !== null) throw this.inviteMoreError;
  }
  /**
   * `call.join` 被拒由测试控制：设 `joinCallError`。
   *
   * **真 engine 从不为这类拒绝抛异常**（`FrameLoop.sendFrame` 内部把它转成 `error` 事件，
   * 见 `useCallActions.joinCall` 的注释），这里同形——同步 `emit('error', …)`，
   * 不 throw：调用方靠临时挂的 `error` 监听器拿码，不是 `try/catch`。
   */
  joinCallError: { code: number; name: string; message: string } | null = null;
  /** 加入本身成功，但期间冒出一条与它无关的 `error`（验 joinCall 不把它算成失败）。 */
  joinCallStrayError: { code: number; name: string; message: string } | null = null;
  async joinCall(callId: string): Promise<void> {
    this.calls.push(`joinCall:${callId}`);
    if (this.joinCallStrayError !== null) this.emit('error', this.joinCallStrayError);
    if (this.joinCallError !== null) {
      this.emit('error', this.joinCallError);
      return; // 被拒：通话机留在 idle，与真 engine 同形
    }
    this.state.call.state = 'accepting';
  }
  /** 探测结果由测试控制：默认成功；设 `probeError` 让它抛。 */
  probeError: unknown = null;
  async probeMicrophone(): Promise<void> {
    this.calls.push('probeMic');
    if (this.probeError !== null) throw this.probeError;
  }
  /** 摄像头权限探测由测试控制：设 `cameraProbeError` 让它抛（= 摄像头权限被拒 / 没设备）。 */
  cameraProbeError: unknown = null;
  async probeCamera(): Promise<void> {
    this.calls.push('probeCam');
    if (this.cameraProbeError !== null) throw this.cameraProbeError;
  }
  /**
   * 进房失败由测试控制：设 `joinRoomError` 让它抛。
   *
   * 真 engine 的 `joinRoom` 会**同步**抛 1004（`checkRoomId` 拦下带空格 / 中文的房间号），
   * 而「拿群名当房间号」正是宿主最常见的写法。
   */
  joinRoomError: unknown = null;
  async joinRoom(roomId: string): Promise<void> {
    this.calls.push(`join:${roomId}`);
    if (this.joinRoomError !== null) throw this.joinRoomError;
  }
  async leaveRoom(): Promise<void> {
    this.calls.push('leaveRoom');
  }
  /** 麦克风推流失败由测试控制：探测放掉设备之后被别的程序抢走就是这条路。 */
  publishMicError: unknown = null;
  async publishMicrophone(): Promise<string> {
    this.calls.push('publishMic');
    if (this.publishMicError !== null) throw this.publishMicError;
    this.state.room.publishTrackIds['mic-1'] = 't-mic';
    return 'mic-1';
  }
  /** 预览失败由测试控制：设 `previewError` 让它抛（= 摄像头权限被拒 / 没设备）。 */
  previewError: unknown = null;
  /** 让预览停在「正在起」：设成一个还没 resolve 的 promise，测试 resolve 它才放行。 */
  previewHold: Promise<void> | null = null;
  async startLocalPreview(): Promise<string> {
    this.calls.push('startLocalPreview');
    if (this.previewHold !== null) await this.previewHold;
    if (this.previewError !== null) throw this.previewError;
    return 'cam-1';
  }
  async stopLocalPreview(): Promise<void> {
    this.calls.push('stopLocalPreview');
  }
  /** 发布摄像头失败由测试控制：设 `publishCameraError` 让它抛。 */
  publishCameraError: unknown = null;
  async publishCamera(): Promise<string> {
    this.calls.push('publishCam');
    if (this.publishCameraError !== null) throw this.publishCameraError;
    this.state.room.publishTrackIds['cam-1'] = 't-cam';
    return 'cam-1';
  }
  /** 通话中重新打开摄像头失败由测试控制：设 `unmuteError` 让「打开」那一下抛（重新采集被拒）。 */
  unmuteError: unknown = null;
  async setMuted(cid: string, muted: boolean): Promise<void> {
    this.calls.push(`mute:${cid}:${String(muted)}`);
    if (!muted && this.unmuteError !== null) throw this.unmuteError;
  }
}

/** asEngine 把假实现交给需要 CallEngine 的地方。断言只出现在这一处。 */
export function asEngine(fake: FakeEngine): CallEngine {
  return fake as unknown as CallEngine;
}
