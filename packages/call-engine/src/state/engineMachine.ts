import type { CallContext } from './callMachine.js';
import { initialCallContext, reduceCall, synthesizeNetworkEnd } from './callMachine.js';
import type { RoomContext } from './roomMachine.js';
import { clearedRoom, initialRoomContext, reduceRoom, resumeRoom } from './roomMachine.js';
import type { EmittedEvent, MachineInput, MachineOutput, OutgoingFrame } from './types.js';
import { bool, str } from './types.js';

/**
 * engine 的总状态：把通话机与房间机合起来，并处理只有「合起来」才说得清的事。
 *
 * 四件只有这一层能做的事：
 * 1. **连接级事件**（onConnected / onDisconnected / onKickedOut）由这里抛——
 *    它们既不属于某次通话，也不属于某个房间。（`onDisconnected` 只用来驱动状态迁移，
 *    真正发给宿主的那条由连接层发，因为关闭码只有它知道——见 engine.ts 的 dispatch。）
 * 2. **重连恢复失败**时，房间回 idle **且**通话要本地合成 `onCallEnd(network)`
 *    （协议不变量 I8）——服务端那条 ended 帧送不到我们手里了。
 * 3. **通话机产出的 room.join** 要转成房间机的 join 动作，否则房间状态机不知道
 *    自己正在进房，之后的 join.ok 就没人接。
 * 4. **通话结束时房间要回 idle**。这条是 3 的反向，漏了它的后果比漏 3 还隐蔽：
 *    `call.ended` 之后服务端就把房间销毁了，而房间机还停在 joined，
 *    于是**之后每一帧都发向一个已经不存在的房间**（服务端回 1201 room_not_found），
 *    下一次 joinRoom 还会因为「不在 idle」被本地拒掉——界面永远停在「接通中」。
 */

/** EngineContext 是 engine 的完整状态。 */
export interface EngineContext {
  readonly room: RoomContext;
  readonly call: CallContext;
  /**
   * **本端**这一场从哪一刻算起（本机时钟，毫秒）：抛 `onCallBegin` 时记下，通话回 idle 清零。
   *
   * 强制收场本地算时长要用它（`state/forceEnd.ts`）。整通电话的 `connected_at_ms` 是第一个人
   * 接起来的时刻，中途被拉进来的人拿它算会偏大（2026-09-15 10:05 iOS frank 待了约 6 秒，
   * 本地写成 124 秒）。不进一致性向量：向量只断言通话 / 房间那几个键。与 iOS `callStartedAtMS` 同形。
   */
  readonly callStartedAtMs: number;
}

/** initialEngineContext 是全空态。 */
export const initialEngineContext: EngineContext = {
  room: initialRoomContext,
  call: initialCallContext,
  callStartedAtMs: 0,
};

const CALL_ACTS = new Set(['call', 'accept', 'reject', 'cancel', 'hangup', 'invite_more', 'join_call']);
const ROOM_ACTS = new Set([
  'join',
  'leave',
  'publish',
  'unpublish',
  'mute',
  'subscribe',
  'unsubscribe',
  'update_layer',
  'restart_pub_ice',
]);
/**
 * ROOM_INTERNALS 是**只归房间机**的内部事件。
 *
 * 前五条是帧循环把「房间帧没送到」翻译过来的回滚；最后一条是会议房翻页退订的五秒
 * 迟滞到点（`roomPaging.ts`）。**不显式路由的话它们会落到通话机去，被静默丢掉**——
 * 症状分别是「房间永远停在 joining」和「翻走的人五秒后没退订，订阅位一直占着」。
 *
 * `publish_deferred`（发布没等到应答、挂起等重连）同样只归房间机——**iOS 那边最初漏了
 * 把它加进同一张表，事件被静默路由到通话机丢掉，整个「挂起重放」功能从没生效过，
 * 2026-09-18 才补上**。三端这张表要一起对：Android 的 `roomInternals` 同理。
 */
const ROOM_INTERNALS = new Set([
  'join_failed',
  'leave_failed',
  'publish_failed',
  'publish_deferred',
  'subscribe_failed',
  'unsubscribe_hysteresis_elapsed',
]);

/**
 * reduceEngine 是 engine 状态的唯一入口。
 *
 * `nowMs` 只用来给 `callStartedAtMs` 打点，状态转移本身不看它（I4：禁止由定时器改状态）。
 */
export function reduceEngine(
  ctx: EngineContext,
  input: MachineInput,
  nowMs: number = Date.now(),
): MachineOutput<EngineContext> {
  return stampCallStart(ctx, reduceInput(ctx, input), nowMs);
}

function reduceInput(ctx: EngineContext, input: MachineInput): MachineOutput<EngineContext> {
  if (input.kind === 'recv' && input.type === 'sys.hello.ok') {
    return handleHelloOk(ctx, input.data);
  }
  if (input.kind === 'internal') return handleInternal(ctx, input);
  if (input.kind === 'recv') return routeFrame(ctx, input);
  return routeAct(ctx, input);
}

/**
 * stampCallStart：这一步抛了 `onCallBegin` 就记下此刻；通话回到 idle 就清零；其余沿用。
 *
 * **统一放在入口**：各分支有的沿用 ctx、有的重建 ctx，挨个分支去记迟早漏一条。
 */
function stampCallStart(
  before: EngineContext,
  result: MachineOutput<EngineContext>,
  nowMs: number,
): MachineOutput<EngineContext> {
  let callStartedAtMs = before.callStartedAtMs;
  if (result.emit.some((event) => event.cb === 'onCallBegin')) {
    callStartedAtMs = nowMs;
  } else if (result.state.call.state === 'idle') {
    callStartedAtMs = 0;
  }
  if (result.state.callStartedAtMs === callStartedAtMs) return result;
  return { ...result, state: { ...result.state, callStartedAtMs } };
}

/**
 * handleHelloOk：握手成功。`resumed=false` 时**房间与通话都要归零**——
 * 服务端那边的会话已经过期，装作还在只会让 UI 撒谎。
 */
function handleHelloOk(
  ctx: EngineContext,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<EngineContext> {
  const resumed = bool(data, 'resumed');
  const emit: EmittedEvent[] = [
    { cb: 'onConnected', args: { session_id: str(data, 'session_id'), resumed } },
  ];

  if (!resumed) {
    const dropped = dropLostSession(ctx);
    return { state: dropped.state, send: dropped.send, emit: [...emit, ...dropped.emit] };
  }

  const room = resumeRoom(ctx.room, true);
  emit.push(...room.emit);
  return { state: { ...ctx, room: room.state }, send: [...room.send], emit };
}

/**
 * dropLostSession 收拾「服务端那侧的会话已经没了」这一件事：房间与通话都要收场。
 *
 * 「重连上了但 `resumed=false`」与「断得太久 `session_unrecoverable`」是同一件事的两个
 * 到达时机，所以共用这一段。
 *
 * # 必须给宿主一个收场信号
 *
 * `resumeRoom(ctx, false)` 只是把房间清成 idle，**一个事件都不抛**。有 call 的场合
 * 还有 `onCallEnd(network)` 兜着，可**会议是直接 joinRoom 的、压根没有 call**——
 * 于是房间机悄悄回了 idle，而界面还显示着「会议中」、计时器还在走，用户完全不知道
 * 自己已经掉出去了；更糟的是 `onCallEnd/onRoomLeft` 都没抛，engine 那边的
 * `LEAVE_CALLBACKS` 不命中、`bridge.reset()` 不跑，**上一轮的 PeerConnection 会被
 * 带进下一次进房**（正是 mediaBridge 注释里点名的黑屏成因）。
 *
 * 所以：有通话就抛 `onCallEnd`（唯一出口，不再补 `onRoomLeft`，否则宿主记两遍账），
 * 没通话但在房里就补一条 `onRoomLeft`——房间的收场信号就是它。
 * **iOS 的 `IMRoomMachine.resume` 与 Android 的 `IMRoomMachine.resume` 是同一处漏洞，
 * 补这条要三端一起补。**
 */
function dropLostSession(ctx: EngineContext): MachineOutput<EngineContext> {
  const room = resumeRoom(ctx.room, false);
  const emit: EmittedEvent[] = [...room.emit];
  let call = ctx.call;

  if (ctx.call.state !== 'idle') {
    // 不变量 I8 的那个唯一例外：服务端的 call.ended 送不到，本地合成一条。
    const synthesized = synthesizeNetworkEnd(ctx.call, Date.now());
    call = synthesized.state;
    emit.push(...synthesized.emit);
  } else if (ctx.room.state !== 'idle') {
    emit.push({ cb: 'onRoomLeft', args: { room_id: ctx.room.roomId } });
  }
  return { state: { ...ctx, room: room.state, call }, send: [...room.send], emit };
}

function handleInternal(
  ctx: EngineContext,
  input: Extract<MachineInput, { kind: 'internal' }>,
): MachineOutput<EngineContext> {
  const { name } = input;
  /*
    **服务端那一侧已经不可能再恢复这条会话了**（§1.4 的恢复窗口过了）。

    语义与「重连上了但 resumed=false」完全一样，所以走同一段代码：房间归零、
    通话本地合成一条 ended{network}。差别只在**不必等重连成功**——
    网络一直不回来的话那一刻永远不会到，界面就永远停在「正在重连」、
    连挂断都点不动（真机 2026-09-08 的 iOS 端）。

    「什么时候算过了窗口」由连接层算（只有它知道心跳周期），见 ResumeDeadline。
  */
  if (name === 'session_unrecoverable') return dropLostSession(ctx);
  if (name === 'ws_closed_4403') {
    // 被踢：什么都不留。重连没有意义——那等于跟另一台设备打架。
    return {
      state: { ...ctx, room: clearedRoom('idle'), call: initialCallContext },
      send: [],
      // 不带关闭码：这个内部事件也被「鉴权连续失败」复用，那时真实关闭码是 4401。
      // 关闭码由连接层原样上报（见 engine.ts 里为什么状态机这条不外发）。
      emit: [{ cb: 'onKickedOut', args: {} }, { cb: 'onDisconnected', args: {} }],
    };
  }
  if (name === 'disconnected') {
    const room = reduceRoom(ctx.room, { kind: 'internal', name });
    return {
      state: { ...ctx, room: room.state },
      send: [],
      emit: [{ cb: 'onDisconnected', args: {} }, ...room.emit],
    };
  }
  if (name === 'call_failed') {
    // 交给通话机回 idle；它抛的 onCallEnd 会顺带把房间也清掉（见 liftCall）。
    return liftCall(ctx, reduceCall(ctx.call, { kind: 'internal', name }));
  }
  if (ROOM_INTERNALS.has(name)) {
    const room = reduceRoom(ctx.room, input);
    return { state: { ...ctx, room: room.state }, send: [...room.send], emit: [...room.emit] };
  }
  // 其余内部事件（media_ready）交给通话机。
  const call = reduceCall(ctx.call, { kind: 'internal', name });
  return { state: { ...ctx, call: call.state }, send: [...call.send], emit: [...call.emit] };
}

function routeFrame(
  ctx: EngineContext,
  input: Extract<MachineInput, { kind: 'recv' }>,
): MachineOutput<EngineContext> {
  if (input.type.startsWith('call.')) return liftCall(ctx, reduceCall(ctx.call, input));
  if (input.type.startsWith('room.')) {
    const room = reduceRoom(ctx.room, input);
    return { state: { ...ctx, room: room.state }, send: [...room.send], emit: [...room.emit] };
  }
  return { state: ctx, send: [], emit: [] };
}

function routeAct(
  ctx: EngineContext,
  input: Extract<MachineInput, { kind: 'act' }>,
): MachineOutput<EngineContext> {
  if (CALL_ACTS.has(input.op)) return liftCall(ctx, reduceCall(ctx.call, input));
  if (ROOM_ACTS.has(input.op)) {
    const room = reduceRoom(ctx.room, input);
    return withReject(
      { state: { ...ctx, room: room.state }, send: [...room.send], emit: [...room.emit] },
      room,
    );
  }
  return { state: ctx, send: [], emit: [] };
}

/** withReject 把子状态机的本地拒绝原样带到 engine 层——漏带的话调用方拿不到结果。 */
function withReject<S>(
  lifted: MachineOutput<EngineContext>,
  from: MachineOutput<S>,
): MachineOutput<EngineContext> {
  return from.reject === undefined ? lifted : { ...lifted, reject: from.reject };
}

/**
 * liftCall 把通话机的输出抬到 engine 层，并**把 room.join 转交给房间机**。
 *
 * 不做这一步的话，房间机不知道自己正在进房，随后的 `room.join.ok` 就没人接，
 * UI 会停在「接通中」不动。
 */
function liftCall(
  ctx: EngineContext,
  result: MachineOutput<CallContext>,
): MachineOutput<EngineContext> {
  const send: OutgoingFrame[] = [];
  let room = ctx.room;
  const emit: EmittedEvent[] = [...result.emit];

  for (const frame of result.send) {
    if (frame.type !== 'room.join') {
      send.push(frame);
      continue;
    }
    const joined = reduceRoom(room, {
      kind: 'act',
      op: 'join',
      args: { room_id: frame.data['room_id'], room_token: frame.data['room_token'] },
    });
    room = joined.state;
    send.push(...joined.send);
    emit.push(...joined.emit);
  }

  /*
    通话结束 = 房间没了。服务端在发出 `call.ended` 的同时就销毁了房间（协议 §4.4），
    所以这里只是**本地归零**，不发 room.leave——那一帧只会换回一个 1201。

    也不补抛 onRoomLeft：`onCallEnd` 是所有结束分支的唯一出口（设计 §7.5），
    为同一件事抛两个回调会让宿主的记账重复。
  */
  if (emit.some((event) => event.cb === 'onCallEnd')) {
    room = clearedRoom('idle');
  }
  return withReject({ state: { ...ctx, room, call: result.state }, send, emit }, result);
}
