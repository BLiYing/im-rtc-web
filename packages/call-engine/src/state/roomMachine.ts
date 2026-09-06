import { ErrorCode, errorName } from '../errors.js';
import type { Layer, TrackKind } from '../signaling/enums.js';
import { FrameType } from '../signaling/registry.js';
import { reduceRoomRecv } from './roomRecv.js';
import type { EmittedEvent, MachineInput, MachineOutput, OutgoingFrame } from './types.js';
import { bool, str } from './types.js';

/**
 * 房间状态机：RTC_PROTOCOL.md §5.3 的 TS 实现。
 *
 * 一致性向量：`im-rtc-server/docs/conformance/room_fsm.json`，四端跑同一份。
 *
 * # 三条不变量（协议 §5.3 的 R1~R3）
 *
 * - **R1** 只有 `joined` 才允许 publish / subscribe / mute；其余状态**本地拒绝**，
 *   不发上去让服务端报错。
 * - **R2** `joining` 与 `reconnecting` 期间**禁止发任何房间帧**，但要把用户意图
 *   缓存下来，进房/恢复后一次性重放。这两个状态的共同点是**宿主观察不到**——
 *   它拿到 onCallBegin 就推流是最自然的写法，不该因为一个内部中间态而失败。
 * - **R3** 订阅与换层是**幂等**的：重复 subscribe 同一条 track 等价于换层。
 */

/** RoomState 是房间连接状态。 */
export type RoomState = 'idle' | 'joining' | 'joined' | 'leaving' | 'reconnecting';

/** PublishState 是一条本端 Track 的发布状态。 */
export type PublishState = 'publishing' | 'published' | 'unpublishing';

/** SubscribeState 是一条远端 Track 的订阅状态。 */
export type SubscribeState = 'subscribing' | 'subscribed' | 'unsubscribing';

/** RemoteTrack 是远端 Track 的本地记账。 */
export interface RemoteTrack {
  readonly uid: string;
  readonly kind: TrackKind;
  readonly participantId: string;
}

/** RoomContext 是房间状态机持有的全部数据。 */
export interface RoomContext {
  readonly state: RoomState;
  readonly roomId: string;
  readonly roomToken: string;
  readonly participantId: string;
  readonly autoSubscribe: boolean;
  /** cid → 发布状态。用 cid 而不是 track_id：发布请求发出时还没有 track_id。 */
  readonly publish: Readonly<Record<string, PublishState>>;
  /** cid → 服务端分配的 track_id。 */
  readonly publishTrackIds: Readonly<Record<string, string>>;
  /** track_id → 订阅状态。 */
  readonly subscribe: Readonly<Record<string, SubscribeState>>;
  /** track_id → 远端 Track 记账。`track_unpublished` 帧不带 kind，只能靠它。 */
  readonly remoteTracks: Readonly<Record<string, RemoteTrack>>;
  /** 期望的最高层。track_id → layer。 */
  readonly layers: Readonly<Record<string, Layer>>;
  /** joining / reconnecting 期间缓存的用户意图（不变量 R2）。 */
  readonly buffered: readonly BufferedIntent[];
}

/**
 * BufferedIntent 是攒下来的一次调用，**存的是意图不是帧**。
 *
 * 存帧的话重放时只能原样发出去，状态（比如 `publish[cid]='publishing'`）就漏掉了；
 * 存意图则可以在 joined 态重新走一遍正常路径，跟没缓存过一模一样。
 */
export interface BufferedIntent {
  readonly op: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** initialRoomContext 是 idle 态的初值。 */
export const initialRoomContext: RoomContext = {
  state: 'idle',
  roomId: '',
  roomToken: '',
  participantId: '',
  autoSubscribe: true,
  publish: {},
  publishTrackIds: {},
  subscribe: {},
  remoteTracks: {},
  layers: {},
  buffered: [],
};

/** roomOut 构造一次状态转移的产物。roomRecv.ts 也用它。 */
export function roomOut(
  state: RoomContext,
  send: OutgoingFrame[] = [],
  emit: EmittedEvent[] = [],
): MachineOutput<RoomContext> {
  return { state, send, emit };
}

/** clearedRoom 把房间相关的记账全部清空，但保留 state 由调用方决定。 */
export function clearedRoom(state: RoomState): RoomContext {
  return { ...initialRoomContext, state };
}

/** reduceRoom 是房间状态机的唯一入口。 */
export function reduceRoom(ctx: RoomContext, input: MachineInput): MachineOutput<RoomContext> {
  switch (input.kind) {
    case 'act':
      return reduceRoomAct(ctx, input.op, input.args ?? {});
    case 'recv':
      return reduceRoomRecv(ctx, input.type, input.data);
    case 'internal':
      return reduceRoomInternal(ctx, input.name);
  }
}

function reduceRoomInternal(ctx: RoomContext, name: string): MachineOutput<RoomContext> {
  switch (name) {
    case 'disconnected':
      // 断线**不等于**离房：协议给了 30 秒恢复窗口，房内其他人这时还看得见我们。
      return ctx.state === 'idle' ? roomOut(ctx) : roomOut({ ...ctx, state: 'reconnecting' });
    case 'ws_closed_4403':
    case 'reset':
      return roomOut(clearedRoom('idle'));
    case 'join_failed':
      /*
        进房被拒（房间没了、票过期、已在房里…）。**退回 idle**，否则状态机
        永远停在 joining，之后每次 publish 都被 R1 本地拒成 2005。

        **还要抛 `onRoomLeft`**：只清状态的话宿主什么都不知道，会议界面会一直停在
        「正在进入会议…」——和「呼叫被拒却不回 idle」是同一类毛病，
        界面需要一个明确的收场信号。房间的收场信号就是这一条。
      */
      return ctx.state === 'joining'
        ? roomOut(clearedRoom('idle'), [], [{ cb: 'onRoomLeft', args: { room_id: ctx.roomId } }])
        : roomOut(ctx);
    default:
      return roomOut(ctx);
  }
}

/**
 * resumeRoom 在重连成功后恢复房间：重放缓存的用户意图。
 *
 * `resumed=false` 时**必须回到 idle 并重新 join**（协议 §1.4）——
 * 服务端那边的成员关系已经过期了，装作还在只会让 UI 撒谎。
 */
export function resumeRoom(ctx: RoomContext, resumed: boolean): MachineOutput<RoomContext> {
  if (!resumed) return roomOut(clearedRoom('idle'));
  if (ctx.state !== 'reconnecting') return roomOut(ctx);
  return replayBuffered({ ...ctx, state: 'joined' });
}

/**
 * replayBuffered 在 joined 态把攒下的意图重新走一遍。
 *
 * **重放走的是正常路径**（reduceRoomAct），不是把缓存的帧直接吐出去——
 * 这样状态更新与帧生成永远一致，不会出现「帧发了但本地记账没跟上」。
 */
export function replayBuffered(ctx: RoomContext): MachineOutput<RoomContext> {
  if (ctx.buffered.length === 0) return roomOut(ctx);

  let state: RoomContext = { ...ctx, buffered: [] };
  const send: OutgoingFrame[] = [];
  const emit: EmittedEvent[] = [];
  for (const intent of ctx.buffered) {
    const result = reduceRoomAct(state, intent.op, intent.args);
    state = result.state;
    send.push(...result.send);
    emit.push(...result.emit);
  }
  return roomOut(state, send, emit);
}

function reduceRoomAct(
  ctx: RoomContext,
  op: string,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  if (op === 'join') return joinRoom(ctx, args);
  if (op === 'leave') {
    return ctx.state === 'joined'
      ? roomOut({ ...ctx, state: 'leaving' }, [
          { type: FrameType.roomLeave, data: { room_id: ctx.roomId } },
        ])
      : localReject(ctx);
  }

  // R1：只有 joined 才允许发布/订阅类操作。
  // R2：**joining 与 reconnecting** 期间把意图缓存下来，之后重放——
  //     不是丢掉，也不是发上去。这两个状态宿主都观察不到，
  //     在它们上面报「状态非法」等于让宿主为一个内部细节买单。
  if (ctx.state === 'joining' || ctx.state === 'reconnecting') {
    return bufferIntent(ctx, op, args);
  }
  if (ctx.state !== 'joined') return localReject(ctx);

  switch (op) {
    case 'publish':
      return publishTrack(ctx, args);
    case 'unpublish':
      return unpublishTrack(ctx, args);
    case 'mute':
      return roomOut(ctx, [{ type: FrameType.roomMute, data: muteData(args) }]);
    case 'subscribe':
      return subscribeTrack(ctx, args);
    case 'unsubscribe':
      return unsubscribeTrack(ctx, args);
    case 'update_layer':
      return updateLayer(ctx, args);
    /*
      上行那条 PC 断了，重新 offer 一次把 ICE 打回来（媒体层已经把 restart 位置好了）。
      **不进 BUFFERABLE_OPS**：这是「此刻网断了」的即时反应，等到重放的时候
      那条 PC 早就换过一轮了，补发一个过期的重启只会白折腾一次协商。
    */
    case 'restart_pub_ice':
      return roomOut(ctx, [{ type: FrameType.roomOffer, data: { pc: 'pub', sdp: '' } }]);
    default:
      return localReject(ctx);
  }
}

function joinRoom(
  ctx: RoomContext,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  if (ctx.state !== 'idle') return localReject(ctx);
  // auto_subscribe 默认 true——直接读 args 会把「没写」当成 false，
  // 那正是协议 §2.4 点名的发送侧陷阱。
  const autoSubscribe = args['auto_subscribe'] === undefined ? true : bool(args, 'auto_subscribe');
  const roomId = str(args, 'room_id');
  const roomToken = str(args, 'room_token');

  return roomOut({ ...ctx, state: 'joining', roomId, roomToken, autoSubscribe }, [
    {
      type: FrameType.roomJoin,
      data: { room_id: roomId, room_token: roomToken, auto_subscribe: autoSubscribe },
    },
  ]);
}

function publishTrack(
  ctx: RoomContext,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  const cid = str(args, 'cid');
  return roomOut({ ...ctx, publish: { ...ctx.publish, [cid]: 'publishing' } }, [
    {
      type: FrameType.roomPublish,
      data: {
        cid,
        kind: str(args, 'kind'),
        source: str(args, 'source'),
        simulcast: bool(args, 'simulcast'),
      },
    },
  ]);
}

function unpublishTrack(
  ctx: RoomContext,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  const trackId = str(args, 'track_id');
  const cid = cidOfTrack(ctx, trackId);
  const publish = { ...ctx.publish };
  if (cid !== undefined) publish[cid] = 'unpublishing';

  return roomOut({ ...ctx, publish }, [
    { type: FrameType.roomUnpublish, data: { track_id: trackId } },
  ]);
}

/**
 * subscribeTrack：**重复订阅等价于换层**（不变量 R3）。
 *
 * 客户端的订阅与服务端的 `track_unpublished` 天然会赛跑，所以这条路径必须幂等。
 */
function subscribeTrack(
  ctx: RoomContext,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  const trackId = str(args, 'track_id');
  const maxLayer = (str(args, 'max_layer') || 'm') as Layer;

  if (ctx.subscribe[trackId] !== undefined) {
    return roomOut({ ...ctx, layers: { ...ctx.layers, [trackId]: maxLayer } }, [
      { type: FrameType.roomUpdateLayer, data: { track_id: trackId, max_layer: maxLayer } },
    ]);
  }
  return roomOut(
    {
      ...ctx,
      subscribe: { ...ctx.subscribe, [trackId]: 'subscribing' },
      layers: { ...ctx.layers, [trackId]: maxLayer },
    },
    [{ type: FrameType.roomSubscribe, data: { track_id: trackId, max_layer: maxLayer } }],
  );
}

function unsubscribeTrack(
  ctx: RoomContext,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  const trackId = str(args, 'track_id');
  return roomOut({ ...ctx, subscribe: { ...ctx.subscribe, [trackId]: 'unsubscribing' } }, [
    { type: FrameType.roomUnsubscribe, data: { track_id: trackId } },
  ]);
}

function updateLayer(
  ctx: RoomContext,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  const trackId = str(args, 'track_id');
  const maxLayer = (str(args, 'max_layer') || 'm') as Layer;
  return roomOut({ ...ctx, layers: { ...ctx.layers, [trackId]: maxLayer } }, [
    { type: FrameType.roomUpdateLayer, data: { track_id: trackId, max_layer: maxLayer } },
  ]);
}

/** BUFFERABLE_OPS 是值得攒下来重放的操作——正好是 R1 管的那一组。 */
const BUFFERABLE_OPS: ReadonlySet<string> = new Set([
  'publish',
  'unpublish',
  'mute',
  'subscribe',
  'unsubscribe',
  'update_layer',
]);

/** bufferIntent 把中间态期间的用户意图缓存起来（不变量 R2）。 */
function bufferIntent(
  ctx: RoomContext,
  op: string,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  // 不认识的 op 照旧本地拒绝：缓存的是**合法但来早了**的调用，不是笔误。
  if (!BUFFERABLE_OPS.has(op)) return localReject(ctx);
  return roomOut({ ...ctx, buffered: [...ctx.buffered, { op, args }] });
}

function muteData(args: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { track_id: str(args, 'track_id'), muted: bool(args, 'muted') };
}

function cidOfTrack(ctx: RoomContext, trackId: string): string | undefined {
  return Object.entries(ctx.publishTrackIds).find(([, id]) => id === trackId)?.[0];
}

/** localReject 是不变量 R1 的落点：错误状态下的调用**本地拒绝**，不发上去。 */
function localReject(ctx: RoomContext): MachineOutput<RoomContext> {
  return roomOut(ctx, [], [
    {
      cb: 'onError',
      args: { code: ErrorCode.invalidState, name: errorName(ErrorCode.invalidState) },
    },
  ]);
}
