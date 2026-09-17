import type { EngineWiring } from './engineWiring.js';
import { engineConnectionHandlers, engineMediaDeps } from './engineWiring.js';
import { ErrorCode, RtcError } from './errors.js';
import type { MediaBridge } from './media/mediaBridge.js';
import { mediaEvents } from './media/mediaPlane.js';
import type { Connection, HelloOk } from './signaling/connection.js';
import { createConnection } from './signaling/connectionFactory.js';
import type { WebSocketFactory } from './signaling/webSocket.js';

/** SessionOptions 是建连要用的那几项，取自 `EngineOptions`。 */
export interface SessionOptions {
  readonly url: string;
  readonly deviceId: string;
  readonly webSocketFactory?: WebSocketFactory;
}

/**
 * EngineSession 管「当前这条信令连接」：建连握手、换票、关连接，以及握手拿到的 uid。
 *
 * 从 `CallEngine` 里单拎出来：`login` / `updateToken` / `logout` 的**公开签名与文档**留在门面上
 * （那是宿主读的东西），搬过来的是它们背后的三份状态与收摊逻辑——门面自己不再持有连接。
 * 「为什么重复 login 要拒」「失败为什么要收摊」这些理由写在 `CallEngine.login` 上，这里不重复。
 */
export class EngineSession {
  private conn: Connection | null = null;
  /** 握手拿到的自己的 uid。用来挡「呼叫自己」，也供宿主读。登出不清。 */
  private myUid = '';
  /** 最近一次 hello.ok 喂进状态机的那个 promise，`open()` 要等它。 */
  private helloApplied: Promise<void> = Promise.resolve();

  /** `wiring` 取成函数：门面的接线里要回读本会话的 `connection`，构造时还拿不到。 */
  constructor(
    private readonly options: SessionOptions,
    private readonly bridge: MediaBridge,
    private readonly wiring: () => EngineWiring,
  ) {}

  /** 当前连接。会随登录 / 登出换对象，别存下来。 */
  get connection(): Connection | null {
    return this.conn;
  }

  get uid(): string {
    return this.myUid;
  }

  /** open 建连并完成握手，等状态机吃完 hello.ok 再返回。已有连接时抛 `2005`。 */
  async open(token: string): Promise<HelloOk> {
    if (this.conn !== null) {
      throw new RtcError(ErrorCode.invalidState, {
        cause: new Error('已经登录了：换账号或换票请先 logout()'),
      });
    }
    const { url, deviceId, webSocketFactory } = this.options;
    const connection = createConnection(
      { url, token, deviceId, ...(webSocketFactory === undefined ? {} : { webSocketFactory }) },
      engineConnectionHandlers(this.wiring(), (applied): void => {
        this.helloApplied = applied;
      }),
    );
    this.conn = connection;
    this.bridge.open(mediaEvents(engineMediaDeps(this.wiring())));

    let hello: HelloOk;
    try {
      hello = await connection.connect();
    } catch (err) {
      // 收摊：不收的话上面那道「已经登录了」的门会把重试也挡掉。
      connection.close();
      this.bridge.close();
      if (this.conn === connection) this.conn = null;
      throw err;
    }
    this.myUid = hello.uid;
    // 宿主拿到 login 的返回值时，engine 的状态应该已经是最终的了。（重连那些不需要等——没人在 await 它们。）
    await this.helloApplied;
    return hello;
  }

  updateToken(token: string, expiresAtMs?: number): void {
    this.conn?.updateToken(token, expiresAtMs);
  }

  /** close 关掉当前连接。媒体与状态机由门面的 `logout()` 一并收。 */
  close(): void {
    this.conn?.close();
    this.conn = null;
  }
}
