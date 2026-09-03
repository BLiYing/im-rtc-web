import type { TrackKind } from '../signaling/enums.js';
import { FrameType } from '../signaling/registry.js';
import type { PublishState, RemoteTrack, RoomContext, SubscribeState } from './roomMachine.js';
import { clearedRoom, roomOut } from './roomMachine.js';
import type { EmittedEvent, MachineOutput, OutgoingFrame } from './types.js';
import { bool, str } from './types.js';

/**
 * 房间状态机的**下行帧**分支。
 *
 * 与 roomMachine.ts 拆开是体量红线（CONVENTIONS §2）；「上行动作」与「下行帧」
 * 本来也是两组独立的关注点。
 */

const ROOM_JOIN_OK = `${FrameType.roomJoin}.ok`;
const ROOM_LEAVE_OK = `${FrameType.roomLeave}.ok`;
const ROOM_PUBLISH_OK = `${FrameType.roomPublish}.ok`;
const ROOM_UNPUBLISH_OK = `${FrameType.roomUnpublish}.ok`;
const ROOM_UNSUBSCRIBE_OK = `${FrameType.roomUnsubscribe}.ok`;

/** reduceRoomRecv 处理一条下行房间帧。 */
export function reduceRoomRecv(
  ctx: RoomContext,
  type: string,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  switch (type) {
    case ROOM_JOIN_OK:
      return handleJoinOk(ctx, data);
    case ROOM_LEAVE_OK:
      return roomOut(clearedRoom('idle'), [], [
        { cb: 'onRoomLeft', args: { room_id: ctx.roomId } },
      ]);
    case ROOM_PUBLISH_OK:
      return handlePublishOk(ctx, data);
    case FrameType.roomAnswer:
      // 服务端对 pub offer 的应答：本端那条上行协商完成了。
      return roomOut({ ...ctx, publish: promoteAll(ctx.publish, 'publishing', 'published') });
    case FrameType.roomOffer:
      return handleSubOffer(ctx, data);
    case ROOM_UNPUBLISH_OK:
      return roomOut({ ...ctx, publish: dropByState(ctx.publish, 'unpublishing') });
    case ROOM_UNSUBSCRIBE_OK:
      return roomOut({ ...ctx, subscribe: dropByState(ctx.subscribe, 'unsubscribing') });
    case FrameType.roomParticipantJoined:
      return roomOut(ctx, [], [{ cb: 'onUserEnter', args: { uid: str(data, 'uid') } }]);
    case FrameType.roomParticipantLeft:
      return handleParticipantLeft(ctx, data);
    case FrameType.roomTrackPublished:
      return handleTrackPublished(ctx, data);
    case FrameType.roomTrackUnpublished:
      return handleTrackUnpublished(ctx, data);
    case FrameType.roomTrackMuted:
      return handleTrackMuted(ctx, data);
    case FrameType.roomActiveSpeakers:
      return roomOut(ctx, [], [{ cb: 'onActiveSpeakers', args: { speakers: data['speakers'] } }]);
    case FrameType.roomQuality:
      return roomOut(ctx, [], [{ cb: 'onNetworkQuality', args: { entries: data['entries'] } }]);
    case FrameType.roomClosed:
      return roomOut(clearedRoom('idle'), [], [
        {
          cb: 'onRoomClosed',
          args: { room_id: str(data, 'room_id'), reason: str(data, 'reason') },
        },
      ]);
    default:
      // 其余的 .ok（subscribe / update_layer / mute）不改状态也不抛回调。
      return roomOut(ctx);
  }
}

/** handleJoinOk 用快照把房间一次性搭起来：先成员，再他们的 Track。 */
function handleJoinOk(
  ctx: RoomContext,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  const emit: EmittedEvent[] = [{ cb: 'onRoomJoined', args: { room_id: str(data, 'room_id') } }];
  const remoteTracks: Record<string, RemoteTrack> = { ...ctx.remoteTracks };
  const subscribe: Record<string, SubscribeState> = { ...ctx.subscribe };

  for (const participant of asArray(data['participants'])) {
    emit.push({ cb: 'onUserEnter', args: { uid: str(participant, 'uid') } });
  }
  for (const track of asArray(data['tracks'])) {
    const trackId = str(track, 'track_id');
    const kind = str(track, 'kind') === 'video' ? 'video' : 'audio';
    remoteTracks[trackId] = {
      uid: str(track, 'uid'),
      kind,
      participantId: str(track, 'participant_id'),
    };
    emit.push(availabilityEvent(kind, str(track, 'uid'), !bool(track, 'muted')));
    // 自动订阅是**服务端**做的，客户端这边只记账，等 sub offer 来把它们坐实。
    if (ctx.autoSubscribe) subscribe[trackId] = 'subscribing';
  }

  return roomOut(
    {
      ...ctx,
      state: 'joined',
      roomId: str(data, 'room_id'),
      participantId: str(data, 'participant_id'),
      remoteTracks,
      subscribe,
    },
    [],
    emit,
  );
}

function handlePublishOk(
  ctx: RoomContext,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  const cid = str(data, 'cid');
  const trackId = str(data, 'track_id');
  // 拿到 track_id 之后才发 pub offer：服务端要靠 msid 里的 cid 认领 m-line（§3.2）。
  return roomOut(
    { ...ctx, publishTrackIds: { ...ctx.publishTrackIds, [cid]: trackId } },
    [{ type: FrameType.roomOffer, data: { pc: 'pub', sdp: '' } }],
  );
}

/**
 * handleSubOffer：**sub PC 的 offerer 恒为服务端**（§3.3），我们只负责应答。
 * 应答的同时把「订阅中」坐实为「已订阅」——那条流这时才真的挂上来。
 */
function handleSubOffer(
  ctx: RoomContext,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  if (str(data, 'pc') !== 'sub') return roomOut(ctx);
  const send: OutgoingFrame[] = [{ type: FrameType.roomAnswer, data: { pc: 'sub', sdp: '' } }];
  return roomOut(
    { ...ctx, subscribe: promoteAll(ctx.subscribe, 'subscribing', 'subscribed') },
    send,
  );
}

function handleParticipantLeft(
  ctx: RoomContext,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  const participantId = str(data, 'participant_id');
  const remoteTracks: Record<string, RemoteTrack> = {};
  const subscribe: Record<string, SubscribeState> = { ...ctx.subscribe };

  for (const [trackId, track] of Object.entries(ctx.remoteTracks)) {
    if (track.participantId === participantId) {
      // 人走了，他的 Track 与我们对它的订阅一起清掉——不清的话重连时会重放一个死订阅。
      delete subscribe[trackId];
      continue;
    }
    remoteTracks[trackId] = track;
  }

  return roomOut({ ...ctx, remoteTracks, subscribe }, [], [
    { cb: 'onUserLeave', args: { uid: str(data, 'uid') } },
  ]);
}

function handleTrackPublished(
  ctx: RoomContext,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  const trackId = str(data, 'track_id');
  const kind: TrackKind = str(data, 'kind') === 'video' ? 'video' : 'audio';
  const uid = str(data, 'uid');
  const subscribe = { ...ctx.subscribe };
  if (ctx.autoSubscribe) subscribe[trackId] = 'subscribing';

  return roomOut(
    {
      ...ctx,
      remoteTracks: {
        ...ctx.remoteTracks,
        [trackId]: { uid, kind, participantId: str(data, 'participant_id') },
      },
      subscribe,
    },
    [],
    [availabilityEvent(kind, uid, !bool(data, 'muted'))],
  );
}

/** handleTrackUnpublished：帧里**不带 kind**，只能靠本地记账知道该抛音频还是视频事件。 */
function handleTrackUnpublished(
  ctx: RoomContext,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  const trackId = str(data, 'track_id');
  const known = ctx.remoteTracks[trackId];
  const remoteTracks = { ...ctx.remoteTracks };
  const subscribe = { ...ctx.subscribe };
  delete remoteTracks[trackId];
  delete subscribe[trackId];

  const emit: EmittedEvent[] =
    known === undefined ? [] : [availabilityEvent(known.kind, known.uid, false)];
  return roomOut({ ...ctx, remoteTracks, subscribe }, [], emit);
}

function handleTrackMuted(
  ctx: RoomContext,
  data: Readonly<Record<string, unknown>>,
): MachineOutput<RoomContext> {
  const kind: TrackKind = str(data, 'kind') === 'video' ? 'video' : 'audio';
  return roomOut(ctx, [], [availabilityEvent(kind, str(data, 'uid'), !bool(data, 'muted'))]);
}

/** availabilityEvent 把「Track 有没有」翻译成 §7.5 的两个回调之一。 */
function availabilityEvent(kind: TrackKind, uid: string, available: boolean): EmittedEvent {
  return {
    cb: kind === 'video' ? 'onUserVideoAvailable' : 'onUserAudioAvailable',
    args: { uid, available },
  };
}

function promoteAll<T extends string>(
  map: Readonly<Record<string, T>>,
  from: T,
  to: T,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = value === from ? to : value;
  }
  return out;
}

function dropByState<T extends string>(
  map: Readonly<Record<string, T>>,
  target: T,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    if (value !== target) out[key] = value;
  }
  return out;
}

function asArray(value: unknown): Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Readonly<Record<string, unknown>> =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
  );
}

/** publishStateOf 供测试与诊断读取某个 cid 的发布状态。 */
export function publishStateOf(ctx: RoomContext, cid: string): PublishState | undefined {
  return ctx.publish[cid];
}
