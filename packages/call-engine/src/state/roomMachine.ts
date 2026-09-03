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
 * - **R2** `reconnecting` 期间**禁止发任何房间帧**，但要把用户意图缓存下来，
 *   恢复后一次性重放。
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
  /** reconnecting 期间缓存的用户意图（不变量 R2）。 */
  readonly buffered: readonly OutgoingFrame[];
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
      // 进房被拒（房间没了、票过期、已在房里…）。**退回 idle**，否则状态机
      // 永远停在 joining，之后每次 publish 都被 R1 本地拒成 2005。
      return ctx.state === 'joining' ? roomOut(clearedRoom('idle')) : roomOut(ctx);
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
  return roomOut({ ...ctx, state: 'joined', buffered: [] }, [...ctx.buffered]);
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
  // R2：reconnecting 期间把意图缓存下来，恢复后重放——不是丢掉，也不是发上去。
  if (ctx.state === 'reconnecting') return bufferIntent(ctx, op, args);
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

/** bufferIntent 把 reconnecting 期间的用户意图缓存起来（不变量 R2）。 */
function bufferIntent(
  ctx: RoomContext,
  op: string,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  if (op !== 'mute') return roomOut(ctx); // 只有开关麦/摄像头值得重放
  const frame: OutgoingFrame = { type: FrameType.roomMute, data: muteData(args) };
  return roomOut({ ...ctx, buffered: [...ctx.buffered, frame] });
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
