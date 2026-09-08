import type { EngineBus } from './engineBus.js';
import type { FrameLoop } from './frameLoop.js';
import type { MediaBridge } from './media/mediaBridge.js';
import type { MediaPlaneDeps } from './media/mediaPlane.js';
import { renegotiateAfterResume } from './media/mediaPlane.js';
import type { Connection } from './signaling/connection.js';
import type { EngineConnectionHandlers } from './signaling/connectionFactory.js';
import type { FrameSender } from './signaling/frameSender.js';

/**
 * 门面的**装配**那一半：把连接回调与媒体依赖拼出来。
 *
 * 单拎出来不是为了凑行数——这两块是 `CallEngine` 里**唯一不属于公开 API 的东西**。
 * 它旁边那些方法（`call` / `accept` / `publishCamera` …）是宿主直接调的签名，
 * 拆出去只会让每个方法多一跳；而这两块是纯接线，宿主永远看不见，
 * 放在门面里只是让那个文件一直贴着 400 行的红线。
 */

/** EngineWiring 是接线要用到的那一把东西。 */
export interface EngineWiring {
  bus: EngineBus;
  bridge: MediaBridge;
  sender: FrameSender;
  loop: FrameLoop;
  /**
   * 当前连接。**取成函数**：它会随重连换对象，传值的话拿到的是构造那一刻的旧账。
   */
  connection: () => Connection | null;
}

/**
 * engineMediaDeps 是交给媒体接线的那一小把依赖（见 media/mediaPlane.ts）。
 *
 * `uidOf` 同样读的是状态机的**当前**快照，理由和 `connection` 那条一样。
 */
export function engineMediaDeps(w: EngineWiring): MediaPlaneDeps {
  return {
    bridge: w.bridge,
    bus: w.bus,
    sender: w.sender,
    connection: w.connection,
    uidOf: (trackId): string => w.loop.state.room.remoteTracks[trackId]?.uid ?? '',
    dispatch: (input): Promise<void> => w.loop.dispatch(input),
  };
}

/**
 * engineConnectionHandlers 把连接层的回调接到状态机与事件总线上。
 *
 * `noteHelloApplied` 是回给门面的那条线：`login()` 要 await「hello.ok 已经喂进状态机」，
 * 而握手结果**每一次**都从这里进来（包括自动重连那些），所以 promise 只能由这里产出。
 */
export function engineConnectionHandlers(
  w: EngineWiring,
  noteHelloApplied: (applied: Promise<void>) => void,
): EngineConnectionHandlers {
  return {
    // **握手结果一律从这里进状态机**，`login()` 不再自己喂一遍。
    // 为什么（连同那次实测症状）写在 `EngineConnectionHandlers.onConnected` 上。
    onConnected: (hello): void => {
      const applied = w.loop
        .dispatch({
          kind: 'recv',
          type: 'sys.hello.ok',
          data: { session_id: hello.sessionId, resumed: hello.resumed },
        })
        .then(async () => {
          // 恢复之后要重新协商上行（§1.4）。**为什么触发点在这里**见 renegotiateAfterResume。
          if (hello.resumed) await renegotiateAfterResume(engineMediaDeps(w));
        });
      noteHelloApplied(applied);
      void applied.catch((err: unknown) => w.bus.emitError(err));
    },
    onEvent: (type, data): void => void w.loop.handleIncoming(type, data),
    onDisconnected: (info): void => {
      void w.loop.dispatch({ kind: 'internal', name: 'disconnected' });
      w.bus.emit('disconnected', info);
    },
    onSessionUnrecoverable: (): void =>
      void w.loop.dispatch({ kind: 'internal', name: 'session_unrecoverable' }),
    onKickedOut: (info): void => {
      // 状态机只认「被踢了」这一件事，原因是给宿主做处置判断的，两者分开走。
      void w.loop.dispatch({ kind: 'internal', name: 'ws_closed_4403' });
      w.bus.emit('kickedOut', info);
    },
    onTokenWillExpire: (info): void => w.bus.emit('tokenWillExpire', info),
    onError: (error): void => w.bus.emitError(error),
  };
}
