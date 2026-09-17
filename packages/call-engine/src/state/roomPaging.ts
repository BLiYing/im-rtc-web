import { ErrorCode, errorName } from '../errors.js';
import type { Layer } from '../signaling/enums.js';
import { FrameType } from '../signaling/registry.js';
import type { RoomContext } from './roomMachine.js';
import { roomOut } from './roomMachine.js';
import type { MachineOutput, OutgoingFrame } from './types.js';

/**
 * 会议房的**按页订阅**：把「这个人现在看得见吗」翻译成订阅与退订。
 *
 * 见 `im-rtc-server/docs/design/MEETING_ROOM_DESIGN.md` §4.3。
 *
 * # 为什么挂在 setRemoteLayer 上，而不是新开一个 API
 *
 * **Engine 的公开 API 一个都不新增。** Kit 与自画 UI 的宿主本来就得按可视尺寸调
 * `setRemoteLayer(uid, layer)`（九宫格报 `l`、放大报 `h`、看不见报 `none`），
 * 这套调用已经**完整地表达了「谁在当前页」**。会议房要的只是把同一组调用
 * 翻译成另一套帧：`l/m/h` = 订阅或换层，`none` = 五秒后退订。
 * 新开一个 `subscribePage()` 的话，宿主要为「会议」写第二套界面代码，
 * 而两套之间的差别只有引擎自己知道。
 *
 * # 只在 auto_subscribe='audio' 的房间里生效
 *
 * 通话房是 `all`：服务端全自动订好，`none` 的语义只是**暂停下发**（协议 §3.5），
 * 退订会让那个人永远消失。这条分支写错的后果就是通话房里有人的画面再也回不来，
 * 所以向量里给通话房单列了一组护栏用例（`room_fsm.json` 的
 * `call_room_auto_subscribe_all_layer_only`）。
 */

/**
 * UNSUBSCRIBE_HYSTERESIS_MS 是翻页离开之后**等多久才真的退订**。
 *
 * 退订要重协商（sub PC 少一条 m-line），而翻页是来回的动作：左滑一页看一眼再滑回来
 * 是最常见的操作。立刻退订的话这一来一回要两次协商，回来那一下还得重新等关键帧，
 * 画面黑一下。等五秒，来回翻的那一种就一次协商都不用。
 *
 * 定时器不在状态机里（状态机是纯的，I4：禁止由定时器改状态）：
 * 由帧循环按 {@link RoomContext.pendingUnsubscribe} 排，到点喂一个内部事件回来。
 */
export const UNSUBSCRIBE_HYSTERESIS_MS = 5_000;

/**
 * MAX_SUBSCRIBED_VIDEO 是同时订阅的视频路数上限（手机：本页 8 + 迟滞 8）。
 *
 * **这个数是 SDP 墙定的，不是算力定的**：sub offer 每订一路多一条 m-line，
 * 整帧超过 64 KiB 就发不出去，而发不出去的后果是这个人的下行**永久冻结**
 * （设计 §1.3）。所以它是硬上限，不是一个可以「先超一点看看」的建议值。
 */
export const MAX_SUBSCRIBED_VIDEO = 16;

/** usesPagedVideo 报告这个房间的视频是不是由客户端按页订阅的。 */
export function usesPagedVideo(ctx: RoomContext): boolean {
  return ctx.autoSubscribe === 'audio';
}

/**
 * pagedUpdateLayer 把一次 `setRemoteLayer` 翻译成订阅动作。
 *
 * - `none`：**先发 `room.update_layer{none}` 立刻停包**，再排五秒的退订。
 *   两件事都要：停包省的是带宽（这一下就生效），退订省的是 m-line（五秒后才值得付那次协商）。
 * - `l/m/h`：撤掉还没到点的退订；订过就只换层（**不重协商**，这正是迟滞想省下的那一次），
 *   没订过就订。
 */
export function pagedUpdateLayer(
  ctx: RoomContext,
  trackId: string,
  maxLayer: Layer,
): MachineOutput<RoomContext> {
  return maxLayer === 'none' ? pageOut(ctx, trackId) : pageIn(ctx, trackId, maxLayer);
}

function pageOut(ctx: RoomContext, trackId: string): MachineOutput<RoomContext> {
  // 没订过的不用退；已经排着退订的也不用再报一次 none——它早就不出包了，
  // 再报一次只会把五秒的计时重新拉长。
  if (ctx.subscribe[trackId] === undefined) return roomOut(ctx);
  if (ctx.pendingUnsubscribe.includes(trackId)) return roomOut(ctx);

  return roomOut(
    {
      ...ctx,
      layers: { ...ctx.layers, [trackId]: 'none' },
      pendingUnsubscribe: [...ctx.pendingUnsubscribe, trackId],
    },
    [{ type: FrameType.roomUpdateLayer, data: { track_id: trackId, max_layer: 'none' } }],
  );
}

function pageIn(ctx: RoomContext, trackId: string, maxLayer: Layer): MachineOutput<RoomContext> {
  const kept = { ...ctx, pendingUnsubscribe: without(ctx.pendingUnsubscribe, trackId) };
  const state = kept.subscribe[trackId];
  if (state === 'subscribing' || state === 'subscribed') {
    return roomOut({ ...kept, layers: { ...kept.layers, [trackId]: maxLayer } }, [
      { type: FrameType.roomUpdateLayer, data: { track_id: trackId, max_layer: maxLayer } },
    ]);
  }

  const room = freeSlot(kept);
  if (countLiveVideo(room.ctx) >= MAX_SUBSCRIBED_VIDEO) {
    /*
      腾不出位置：**只可能是调用方一次要看超过 16 路视频**。

      翻页翻不出这种局面（一页 8 路，迟滞里的旧页会在上面被强制退掉）。
      所以这是界面那边的 bug，不是引擎该悄悄吞掉的事——本地拒绝，
      让它经 `setRemoteLayer` 的 error 事件露出来。

      **不排队**：排队要有一个「什么时候轮到你」的触发点，而这里没有——
      订阅位是靠翻页腾出来的，队列只会安静地越积越长，
      表现成「第 17 个人的画面永远不出来，也没有任何报错」。
    */
    return {
      ...roomOut(room.ctx, room.send),
      reject: { code: ErrorCode.invalidState, name: errorName(ErrorCode.invalidState) },
    };
  }

  return roomOut(
    {
      ...room.ctx,
      subscribe: { ...room.ctx.subscribe, [trackId]: 'subscribing' },
      layers: { ...room.ctx.layers, [trackId]: maxLayer },
    },
    [
      ...room.send,
      { type: FrameType.roomSubscribe, data: { track_id: trackId, max_layer: maxLayer } },
    ],
  );
}

/**
 * flushHysteresis 让迟滞到点：把排着的退订真的发出去。
 *
 * `trackId` 省略时把**全部**排着的一次清掉（一致性向量用的就是这一种）。
 * 帧循环按 track 排定时器，所以线上走的是带 `trackId` 的那一路。
 *
 * **通话房什么都不做**：它的 `none` 只是暂停，退订会让那个人的画面再也回不来。
 */
export function flushHysteresis(
  ctx: RoomContext,
  trackId?: string,
): MachineOutput<RoomContext> {
  if (!usesPagedVideo(ctx)) return roomOut(ctx);
  const targets =
    trackId === undefined ? ctx.pendingUnsubscribe : ctx.pendingUnsubscribe.filter((id) => id === trackId);
  if (targets.length === 0) return roomOut(ctx);

  let next: RoomContext = {
    ...ctx,
    pendingUnsubscribe: ctx.pendingUnsubscribe.filter((id) => !targets.includes(id)),
  };
  const send: OutgoingFrame[] = [];
  for (const id of targets) {
    const one = unsubscribeNow(next, id);
    next = one.ctx;
    send.push(...one.send);
  }
  return roomOut(next, send);
}

/**
 * dropPending 把已经不存在的 track 从待退订队列里摘掉。
 *
 * 人走了、对方 unpublish 了，那条订阅本来就没了。不摘的话定时器到点会发一条
 * 打在空处的 `room.unsubscribe`（服务端幂等，但帧循环会为它多排一轮）。
 */
export function dropPending(pending: readonly string[], gone: ReadonlySet<string>): string[] {
  return pending.filter((id) => !gone.has(id));
}

function unsubscribeNow(
  ctx: RoomContext,
  trackId: string,
): { ctx: RoomContext; send: OutgoingFrame[] } {
  const state = ctx.subscribe[trackId];
  if (state === undefined || state === 'unsubscribing') return { ctx, send: [] };
  const layers = { ...ctx.layers };
  delete layers[trackId];
  return {
    ctx: { ...ctx, subscribe: { ...ctx.subscribe, [trackId]: 'unsubscribing' }, layers },
    send: [{ type: FrameType.roomUnsubscribe, data: { track_id: trackId } }],
  };
}

/**
 * freeSlot 在订满 16 路时**提前**把排着的退订执行掉，腾出位置。
 *
 * 快速连翻几页就会踩到：第一页还在五秒迟滞里，第二页也翻走了，第三页要订新的。
 * 迟滞是一种便利，不是承诺——位置不够时先退最早翻走的那一页，正是想退的顺序。
 */
function freeSlot(ctx: RoomContext): { ctx: RoomContext; send: OutgoingFrame[] } {
  let next = ctx;
  const send: OutgoingFrame[] = [];
  while (countLiveVideo(next) >= MAX_SUBSCRIBED_VIDEO && next.pendingUnsubscribe.length > 0) {
    const [oldest, ...rest] = next.pendingUnsubscribe;
    const one = unsubscribeNow(next, oldest as string);
    next = { ...one.ctx, pendingUnsubscribe: rest };
    send.push(...one.send);
  }
  return { ctx: next, send };
}

/** countLiveVideo 数此刻**占着 m-line** 的视频路数：订上的与正在订的都算，正在退的不算。 */
function countLiveVideo(ctx: RoomContext): number {
  let count = 0;
  for (const [trackId, state] of Object.entries(ctx.subscribe)) {
    if (state === 'unsubscribing') continue;
    if (ctx.remoteTracks[trackId]?.kind !== 'video') continue;
    count += 1;
  }
  return count;
}

function without(list: readonly string[], value: string): string[] {
  return list.filter((item) => item !== value);
}
