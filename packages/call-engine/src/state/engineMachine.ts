import type { CallContext } from './callMachine.js';
import { initialCallContext, reduceCall, synthesizeNetworkEnd } from './callMachine.js';
import type { RoomContext } from './roomMachine.js';
import { clearedRoom, initialRoomContext, reduceRoom, resumeRoom } from './roomMachine.js';
import type { EmittedEvent, MachineInput, MachineOutput, OutgoingFrame } from './types.js';
import { bool, str } from './types.js';

/**
 * engine 的总状态：把通话机与房间机合起来，并处理只有「合起来」才说得清的事。
 *
 * 三件只有这一层能做的事：
 * 1. **连接级事件**（onConnected / onDisconnected / onKickedOut）由这里抛——
 *    它们既不属于某次通话，也不属于某个房间。
 * 2. **重连恢复失败**时，房间回 idle **且**通话要本地合成 `onCallEnd(network)`
 *    （协议不变量 I8）——服务端那条 ended 帧送不到我们手里了。
 * 3. **通话机产出的 room.join** 要转成房间机的 join 动作，否则房间状态机不知道
 *    自己正在进房，之后的 join.ok 就没人接。
 */

/** EngineContext 是 engine 的完整状态。 */
export interface EngineContext {
  readonly room: RoomContext;
  readonly call: CallContext;
}

/** initialEngineContext 是全空态。 */
export const initialEngineContext: EngineContext = {
  room: initialRoomContext,
  call: initialCallContext,
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
]);

/** reduceEngine 是 engine 状态的唯一入口。 */
export function reduceEngine(
  ctx: EngineContext,
  input: MachineInput,
): MachineOutput<EngineContext> {
  if (input.kind === 'recv' && input.type === 'sys.hello.ok') {
    return handleHelloOk(ctx, input.data);
  }
  if (input.kind === 'internal') return handleInternal(ctx, input.name);
  if (input.kind === 'recv') return routeFrame(ctx, input);
  return routeAct(ctx, input);
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

  const room = resumeRoom(ctx.room, resumed);
  const send: OutgoingFrame[] = [...room.send];
  emit.push(...room.emit);

  let call = ctx.call;
  if (!resumed && ctx.call.state !== 'idle') {
    // 不变量 I8 的那个唯一例外：服务端的 call.ended 送不到，本地合成一条。
    const synthesized = synthesizeNetworkEnd(ctx.call, Date.now());
    call = synthesized.state;
    emit.push(...synthesized.emit);
  }
  return { state: { room: room.state, call }, send, emit };
}

function handleInternal(ctx: EngineContext, name: string): MachineOutput<EngineContext> {
  if (name === 'ws_closed_4403') {
    // 被踢：什么都不留。重连没有意义——那等于跟另一台设备打架。
    return {
      state: { room: clearedRoom('idle'), call: initialCallContext },
      send: [],
      emit: [{ cb: 'onKickedOut', args: {} }, { cb: 'onDisconnected', args: { code: 4403 } }],
    };
  }
  if (name === 'disconnected') {
    const room = reduceRoom(ctx.room, { kind: 'internal', name });
    return {
      state: { room: room.state, call: ctx.call },
      send: [],
      emit: [{ cb: 'onDisconnected', args: {} }, ...room.emit],
    };
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
    return { state: { ...ctx, room: room.state }, send: [...room.send], emit: [...room.emit] };
  }
  return { state: ctx, send: [], emit: [] };
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
  return { state: { room, call: result.state }, send, emit };
}
