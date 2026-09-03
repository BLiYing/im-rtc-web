import type { CallEngine } from '@im-rtc/call-engine';

/**
 * 宿主该怎么伺候一条信令连接 —— **这一整个文件都是「宿主该写的代码」的示范**。
 *
 * # 为什么这件事不能由 SDK 做
 *
 * 协议 §1.5 说 `4401` 的处置是「换新 token 后重连」。票从**宿主的账号体系**来，
 * engine 不认识那套东西，也不该替宿主决定什么时候去要票——所以 engine 只留了
 * `updateToken(token)` 这个口子（push 不 pull），来票的那一步永远在宿主这边。
 *
 * # 两条路，缺一不可
 *
 *  · **还来得及**：`disconnected(4401)` → 取新票 → `updateToken`。重连是 engine
 *    已经排好的（第一档 1 秒），只要在下一次尝试之前调到就行。
 *  · **来不及了**：连续 3 次鉴权失败后 engine 抛 `kickedOut` 收手。这时**必须回登录态**
 *    ——engine 已经死了，界面继续显示「已登录」就是在撒谎。
 *    （实测踩过：服务端重启换了签名密钥，页面一直显示已登录，其实什么都发不出去。）
 */

/** ConnPhase 是给界面看的连接状态。 */
export type ConnPhase = 'connected' | 'reconnecting' | 'refreshing' | 'dead';

/** GuardHooks 是宿主要接的两件事：状态变了、以及被踢了该回登录页。 */
export interface GuardHooks {
  onPhase: (phase: ConnPhase, detail: string) => void;
  onDead: (reason: string) => void;
}

/**
 * guardConnection 挂上「换票 + 回登录」这套处置，返回退订函数。
 *
 * `fetchToken` 就是宿主自己的换票接口；这里不关心它怎么实现。
 */
export function guardConnection(
  engine: CallEngine,
  fetchToken: () => Promise<string>,
  hooks: GuardHooks,
): () => void {
  /*
    同一次断线里只换一次票。不设这个闩的话，三次 4401 会触发三次换票请求，
    而它们拿回来的票是一样的——除了给自己的后台添三倍流量，什么也没改变。
    连上之后清掉，下一轮断线才能再换。
  */
  let refreshing = false;

  const off = [
    engine.on('connected', (e) => {
      refreshing = false;
      hooks.onPhase('connected', e.resumed ? '已恢复原会话' : '新会话');
    }),
    engine.on('disconnected', (e) => {
      if (e.code === 4401 && !refreshing) {
        refreshing = true;
        hooks.onPhase('refreshing', '接入票失效，正在换新票…');
        void fetchToken()
          .then((token) => {
            // 只是把票交给 engine：重连由它按退避档自己发起，我们不催。
            engine.updateToken(token);
            hooks.onPhase('refreshing', '新票已交给 engine，等它下一次重连');
          })
          .catch((err: unknown) => {
            refreshing = false;
            hooks.onPhase('reconnecting', `换票失败：${String(err)}`);
          });
        return;
      }
      if (!e.willReconnect) {
        hooks.onPhase('dead', `连接已断开（${e.code}），不会自动回来`);
        return;
      }
      hooks.onPhase('reconnecting', `已断开（${e.code}），正在重连…`);
    }),
    // kickedOut 有两个来源：同设备号在别处登录，以及**连续三次鉴权失败**。
    // 两者的处置一样——回登录页，因为这条 engine 不会再连回来了。
    engine.on('kickedOut', () => hooks.onDead('登录态已失效（被踢或接入票换不上），请重新登录')),
  ];

  return () => {
    for (const unsubscribe of off) unsubscribe();
  };
}
