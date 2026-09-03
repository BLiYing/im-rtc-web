import type { CallEngine, EngineEventName, EngineEvents, Layer, MediaType } from '@im-rtc/call-engine';

/**
 * FakeEngine 是 uikit 用到的那一小片 engine 接口。
 *
 * **它同时是一份清单**：uikit 只碰下面这些方法，一个私有通道都没有。
 * 哪天这个假实现要加一个新方法，就说明 uikit 伸手伸到了公开事件表之外——
 * 那时该补的是回调表，不是这个文件。
 */
export class FakeEngine {
  readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  readonly attached: { uid: string; hasElement: boolean }[] = [];
  readonly layers: { uid: string; layer: Layer }[] = [];
  readonly calls: string[] = [];
  state = { room: { publishTrackIds: {} as Record<string, string> } };

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

  async call(calleeIds: string[], mediaType: MediaType): Promise<void> {
    this.calls.push(`call:${calleeIds.join(',')}:${mediaType}`);
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
  async joinRoom(roomId: string): Promise<void> {
    this.calls.push(`join:${roomId}`);
  }
  async publishMicrophone(): Promise<string> {
    this.calls.push('publishMic');
    this.state.room.publishTrackIds['mic-1'] = 't-mic';
    return 'mic-1';
  }
  async publishCamera(): Promise<string> {
    this.calls.push('publishCam');
    this.state.room.publishTrackIds['cam-1'] = 't-cam';
    return 'cam-1';
  }
  async setMuted(cid: string, muted: boolean): Promise<void> {
    this.calls.push(`mute:${cid}:${String(muted)}`);
  }
}

/** asEngine 把假实现交给需要 CallEngine 的地方。断言只出现在这一处。 */
export function asEngine(fake: FakeEngine): CallEngine {
  return fake as unknown as CallEngine;
}
