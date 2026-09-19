import { ErrorCode, errorName } from '../errors.js';
import type { AutoSubscribeMode, Layer, TrackKind } from '../signaling/enums.js';
import { AUTO_SUBSCRIBE_MODES } from '../signaling/enums.js';
import { FrameType } from '../signaling/registry.js';
import { flushHysteresis, pagedUpdateLayer, usesPagedVideo } from './roomPaging.js';
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
  /** 进房时声明的自动订阅档位（协议 §3.1）。会议房是 'audio'，通话房是 'all'。 */
  readonly autoSubscribe: AutoSubscribeMode;
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
  /**
   * 翻页翻走、等五秒迟滞到点才退订的 track_id，**最早翻走的排在前面**（`roomPaging.ts`）。
   *
   * 顺序有用：订满 16 路要提前腾位置时，退的就是最早翻走的那一个。
   * **不进一致性向量**——向量只断言 room / publish / subscribe 三个键。
   */
  readonly pendingUnsubscribe: readonly string[];
  /**
   * 这个房间**真的收到过 `room.join.ok`** 吗。
   *
   * 只有它能区分 `reconnecting` 的两种来路：从 `joined` 断的（服务端那边成员关系还在，
   * 恢复后直接回 `joined`），还是从 `joining` 断的（`room.join` 还在飞，服务端从没受理过）。
   * 少了它，{@link resumeRoom} 会把后者也宣布成 `joined`。
   *
   * **不进一致性向量**：向量只断言 `room` / `publish` / `subscribe` 那几个键，
   * 这是本端为了分辨来路自己记的账。四端同一份（iOS / Android 的 `didJoin`）。
   */
  readonly didJoin: boolean;
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
  autoSubscribe: 'all',
  publish: {},
  publishTrackIds: {},
  subscribe: {},
  remoteTracks: {},
  layers: {},
  buffered: [],
  pendingUnsubscribe: [],
  didJoin: false,
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
      return reduceRoomInternal(ctx, input.name, input.args ?? {});
  }
}

function reduceRoomInternal(
  ctx: RoomContext,
  name: string,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
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
    case 'leave_failed':
      /*
        离房被拒（1203 未在房间里、1201 房间没了…）。**照样当离成功收场**——
        服务端回 1203 恰恰说明我们已经不在房里了，本地再挂着毫无意义。

        不接这一条的后果比进房失败更重：房间永久停在 `leaving`，`onRoomLeft` 抛不出去，
        于是 engine 那边的 `LEAVE_CALLBACKS` 不命中、媒体面不归零，**摄像头指示灯一直亮**；
        而之后每次 join / leave 都被 R1 本地拒成 2005，除非 logout 否则再也进不了房。
      */
      return ctx.state === 'leaving'
        ? roomOut(clearedRoom('idle'), [], [{ cb: 'onRoomLeft', args: { room_id: ctx.roomId } }])
        : roomOut(ctx);
    case 'publish_failed':
      return dropFailedPublish(ctx, str(args, 'cid'));
    case 'publish_deferred':
      return deferPublish(ctx, args);
    case 'subscribe_failed':
      return dropFailedSubscribe(ctx, str(args, 'track_id'));
    case 'unsubscribe_hysteresis_elapsed':
      // 翻页退订的五秒到了。带 track_id 就只退那一条（帧循环按 track 排定时器），
      // 不带就把排着的一次清掉（一致性向量用的是这一种）。
      return flushHysteresis(ctx, optionalStr(args, 'track_id'));
    default:
      return roomOut(ctx);
  }
}

/**
 * dropFailedPublish：`room.publish` **被服务端拒绝**时把那条 `publishing` 摘掉（静默失败审计 §A）。
 * 没送到（超时 / 断线）不走这里，走 {@link deferPublish}。
 *
 * 不摘的话它永远停在 `publishing`：`publish.ok` 不会来，pub offer 永远不产出。
 * **通话里走不到这里**——帧循环直接把整通强制收场（reason=error），因为推不上去的那一端
 * 对方全程听不见看不见，留在通话里只是一块撒谎的界面。这里只管没有通话的会议房。
 * 错误本身由帧循环先抛过了，这里不再重复抛。
 */
function dropFailedPublish(ctx: RoomContext, cid: string): MachineOutput<RoomContext> {
  if (ctx.publish[cid] !== 'publishing') return roomOut(ctx);
  const publish = { ...ctx.publish };
  delete publish[cid];
  return roomOut({ ...ctx, publish });
}

/**
 * deferPublish：`room.publish` **没等到应答**（2003/2004/2007）时把这一路挂起来等重连，而不是丢掉。
 *
 * 与 `dropFailedPublish` 的分别只有一条，但这条是根本的：**服务端拒了**是个答复，重试救不回来
 * （房间没了、重复发布），该收场；**超时/断线**根本不是答复，它只说明「这一问没能送到」，
 * 而连接回来之后同一问多半就成了。
 *
 * 2026-09-18 真机撞的正是后者：18:18:39 `room.publish` 超时 → 整通电话被本端收成
 * `reason=error`，而**9 秒后连接就回来了、会话也在恢复窗口内 resume 成功**
 * （服务端 18:18:48「在恢复窗口内重连，取消离房」）。本来能接着打的一通被我们自己判了死刑；
 * 更糟的是那时挂断帧也发不出去，服务端与对端完全不知道，对面对着一个幽灵坐了 3 分钟。
 *
 * 摘掉 `publishing` 之后把同一个意图塞回 `buffered`：`resumeRoom` 回到 `joined` 时
 * `replayBuffered` 会原路重走一遍（**走 `reduceRoomAct`，不是补发旧帧**，所以状态与帧永远一致）。
 * 重连一直不成功的话，`resumeDeadline.ts` 那条给恢复窗口上限的倒计时照样会把通话收场，
 * 这里只是不再抢在它前面下手。
 *
 * **只认 `publishing`**：已经 `published` 的迟到超时、或压根没有这条记账的 cid，
 * 都不碰——不然一条迟到的超时能把已经成功的发布摘掉，恢复后还会重复发布，
 * 换回服务端一个「重复发布」的拒绝（见一致性向量 `publish_deferred_ignored_unless_publishing`）。
 */
function deferPublish(
  ctx: RoomContext,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  const cid = str(args, 'cid');
  if (ctx.publish[cid] !== 'publishing') return roomOut(ctx);
  const publish = { ...ctx.publish };
  delete publish[cid];
  return roomOut({ ...ctx, publish, buffered: [...ctx.buffered, { op: 'publish', args }] });
}

/**
 * dropFailedSubscribe：`room.subscribe` 被拒时把那条 `subscribing` 连同层记账摘掉。
 *
 * 不摘的话不变量 R3 会把之后的每次重订都当成「已经订过、只换层」，
 * 只发 `room.update_layer`，**再也发不出 `room.subscribe`**。最常见的来路是 1301：
 * 订阅与对方的 `track_unpublished` 赛跑输了，此时摘掉正是实情。
 *
 * **待退订队列要一起摘**：会议房里「订上 → 翻走排退订 → 订阅这时才被拒」是能排到的顺序
 * （订阅与翻页各走各的），队列里留着一个已经没有订阅记账的 track，
 * 五秒后会发一条打在空处的 `room.unsubscribe`；要是这中间那个人又翻回来了，
 * 那一条会把**刚重新订上的**那一路退掉，表现成「翻回来看了五秒，画面自己没了」。
 */
function dropFailedSubscribe(ctx: RoomContext, trackId: string): MachineOutput<RoomContext> {
  if (ctx.subscribe[trackId] !== 'subscribing') return roomOut(ctx);
  const subscribe = { ...ctx.subscribe };
  const layers = { ...ctx.layers };
  delete subscribe[trackId];
  delete layers[trackId];
  return roomOut({
    ...ctx,
    subscribe,
    layers,
    pendingUnsubscribe: ctx.pendingUnsubscribe.filter((id) => id !== trackId),
  });
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
  if (!ctx.didJoin) return rejoin(ctx);
  return replayBuffered({ ...ctx, state: 'joined' });
}

/**
 * rejoin 把「进房还没落地就断了」的那一轮**重发一遍**。
 *
 * `disconnected` 会把**任何**非 idle 状态推进 `reconnecting`，`joining` 也在内。
 * 而从 `joining` 断的那一种，`room.join` 当时还在飞：服务端从没受理过我们，
 * 恢复的只是那条 WS 会话，**不是房间成员关系**。原先无条件宣布 `joined`，
 * 于是本端以为自己在房里，之后每一帧都换回 1201/1203，
 * 而重新 join 又因为「不在 idle」被本地拒成 2005——一个哑掉的死局。
 *
 * **本端踩得比另外两端更稳**：`handleClose` 是**同步**调 `onDisconnected` 的，
 * 而 `dispatch` 头一行就同步 reduce；`rejectAll` 触发的 `join_failed` 只能等微任务。
 * 所以 `disconnected` **每次都赢**，那条本该兜住它的 `join_failed` 必定变成空操作
 * （它 guard 在 `joining` 上，而状态早被推走了）。iOS 那边是竞态，这里是稳定复现。
 *
 * 所以判据改成认 {@link RoomContext.didJoin} 这笔账，**不认时序**。
 * 房号与房票都还在手上，该做的正是把那次没落地的进房重来一遍；
 * 攒下的意图照旧留着，等进房后再重放。
 */
function rejoin(ctx: RoomContext): MachineOutput<RoomContext> {
  // 连房号都没有（`join` 的帧还没产出就断了）：没得重发，干净地回 idle。
  if (ctx.roomId === '') return roomOut(clearedRoom('idle'));
  return roomOut({ ...ctx, state: 'joining' }, [
    {
      type: FrameType.roomJoin,
      data: { room_id: ctx.roomId, room_token: ctx.roomToken, auto_subscribe: ctx.autoSubscribe },
    },
  ]);
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
  // auto_subscribe 默认 'all'——直接读 args 会把「没写」当成空串，
  // 那正是协议 §2.4 点名的发送侧陷阱。集合外的值按 §2.4 规则 6 兜底成 'all'。
  const autoSubscribe = coerceAutoSubscribe(args['auto_subscribe']);
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
  // 已经手动退了，排着的那次迟滞退订就不必再来一遍。
  return roomOut(
    {
      ...ctx,
      subscribe: { ...ctx.subscribe, [trackId]: 'unsubscribing' },
      pendingUnsubscribe: ctx.pendingUnsubscribe.filter((id) => id !== trackId),
    },
    [{ type: FrameType.roomUnsubscribe, data: { track_id: trackId } }],
  );
}

/**
 * updateLayer 报某条流的层上界。
 *
 * **会议房里它同时是订阅意图**：视频不由服务端自动订，所以「看得见」= 订阅、
 * 「看不见」= 五秒后退订（`roomPaging.ts`）。通话房照旧只换层。
 */
function updateLayer(
  ctx: RoomContext,
  args: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  const trackId = str(args, 'track_id');
  const maxLayer = (str(args, 'max_layer') || 'm') as Layer;
  if (usesPagedVideo(ctx) && ctx.remoteTracks[trackId]?.kind === 'video') {
    return pagedUpdateLayer(ctx, trackId, maxLayer);
  }
  return roomOut({ ...ctx, layers: { ...ctx.layers, [trackId]: maxLayer } }, [
    { type: FrameType.roomUpdateLayer, data: { track_id: trackId, max_layer: maxLayer } },
  ]);
}

/** coerceAutoSubscribe 把线路上的档位归一化，认不出的一律按 'all'（§2.4 规则 6）。 */
function coerceAutoSubscribe(value: unknown): AutoSubscribeMode {
  if (typeof value !== 'string') return 'all';
  return (AUTO_SUBSCRIBE_MODES as readonly string[]).includes(value)
    ? (value as AutoSubscribeMode)
    : 'all';
}

/** optionalStr 取一个可以缺席的字符串参数。 */
function optionalStr(
  args: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
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
  return {
    ...roomOut(ctx),
    reject: { code: ErrorCode.invalidState, name: errorName(ErrorCode.invalidState) },
  };
}
