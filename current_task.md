# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：只记当前状态，**就地覆盖、不追加**。历史见 `git log`。
> 工程规范见 [CONVENTIONS.md](CONVENTIONS.md)；方案与分期见 `im-rtc-server` 的
> `docs/design/RTC_CALL_DESIGN.md` §10；界面以草图 §06 为准。

## 当前焦点

**P2 全部落地（2026-09-03）：engine + uikit + 两个 Demo 站点，浏览器三方实测通过。**

| 包 | 内容 | 怎么验的 |
|---|---|---|
| `@im-rtc/call-engine` | 协议层、WS 客户端、通话/房间/总状态机、WebRTC 适配器 | 177 个用例，含 50 条四仓共用向量 |
| `@im-rtc/call-uikit-react` | 来电浮层 / 1v1 / 九宫格 / 小窗 / 控制条 | 39 个用例（纯逻辑 + jsdom） |
| `demo`（:5178） | **只引 engine 自画 UI** 的示范 | 浏览器双开 |
| `demo-react`（:5179） | **引 uikit** 的示范：只写登录/拨号/记录/事件流 | 浏览器三开 |

**浏览器实测（三个标签页 + 自建 SFU，非模拟）**：
1v1 视频接通、双向画面、关摄像头对端立刻变头像、小窗收起展开、
挂断后两端同时出现通话记录；三人会议 2×2 九宫格、三路画面都是活的、发言高亮跟着走。

**这一轮 uikit 抓到四个真 bug**（都不报错、只表现为界面不动）：
1. **服务端来的 ICE 候选一直被丢掉**——trickle 只做了一半。之所以能撑到现在，
   是因为 Pion 的 SDP 里常常碰巧已经带着主机候选；进房即订阅时协商发生得早，
   SDP 里一个候选都没有，下行 PC 永远停在 `new`。三方会议必现。
2. **通话结束后房间没回 idle**——之后每一帧都发向一个已销毁的房间。
3. **协商飞行期间来的订阅被丢**（服务端侧，已在 im-rtc-server 修）。
4. **发布时机只认「阶段正好是 connecting」**——而 React 会把同一批事件合并成一次提交，
   connecting 可能一帧都不停留。

**三人会议实测又抓到四个（2026-09-03，全部已修 + 回归用例）**：
5. **会议房里点挂断毫无反应，三端都退不出去**。红按钮无条件走 `hangup`，
   而**会议房里根本没有 call**，通话机把它本地拒成 2005——宿主只看到一条没头没尾的 error。
   会议的结束动作是 `leaveRoom`；视图模型为此多了 `isMeeting`，另外补订阅了
   `roomLeft` / `roomClosed`（会议没有 `callEnd`，漏了就等于没有结束出口）。
6. **4401 会无限重连**。重连带的是**同一枚 token**，服务端重启换了签名密钥之后，
   没关的标签页重试到第 19 次还在敲，日志里全是 `token_invalid`。
   按协议 §1.5 加了「连续 3 次就放弃并抛 `onKickedOut`」。
   放弃必须用**闩**（`Reconnector.stop()`）：`connect()` 被拒那条是微任务，
   排在 close 之后，只取消定时器的话它会把重连又排回来。
7. **一次断线排两次重连**，退避档一次涨两级（日志里 `attempt=14` 紧跟 `attempt=15`）——
   失败会从 close 事件与 `connect()` 被拒两条路走到 `schedule()`。
8. **`disconnected` 每次抛两遍**，其中一遍空载荷；「鉴权到顶」还借用了
   `ws_closed_4403`，于是混进一条**假的 4403**。宿主想数重连次数就数不对。
   现在关闭码由连接层独占上报，状态机那份只驱动状态迁移。

**接着做「Demo 该演示换 token」时又抓到两个（同日）**：
9. **`CallEngine` 根本没暴露 `updateToken`**。`Connection` 上有，门面没有——
   于是协议 §1.5 要求宿主做的那件事（`4401` → 换新票重连），Web 端**做不到**。
   补上公开方法（push 不 pull：不做「token provider 回调」那种让 engine 自己去要票的设计），
   并写进设计文档 §7.5 的主动方法表（四端同名）。
10. **自动重连的握手结果没人接**。`Connection` 会抛 `onConnected`，但
   `connectionFactory` 压根没把它接出去——门面只在 `login()` 里手工喂了一次 hello.ok。
   后果不是「少一个事件」，而是**重连之后状态机不知道自己重连了**：
   `resumed=false` 时房间不归零（之后每帧都发向一个已消失的房间）、
   `resumed=true` 时攒下的意图不重放，宿主也永远收不到第二次 `connected`。
   实测症状：服务端重启后换票重连其实成功了，界面却一直停在「重连中」。
   **iOS 的 `IMConnectionEvents` 连 `onConnected` 都还没有**，已一并补上并写明理由，
   免得 iOS 门面落地时再踩一遍。

同时补上：**九宫格/会议里的静音角标**（`hasAudio` → 🔇，本端读开关、远端读
`userAudioAvailable`），以及 engine 的一条诊断日志「动作被状态机本地拒绝」——
带上 op 与当时的两个状态。第 5 条那次排查全卡在「十几条一模一样的 2005」上，
要读代码才能推出点的是哪个按钮。

## 下一步

**P3 —— iOS**（`../im-rtc-ios`）：协议层 + 三个状态机 + 信令已落地并对着真服务端验过，
剩下门面/回调表、媒体（要真机）、Kit、Demo。**注意：不启模拟器验证**，
只能靠单测 + 一致性向量兜底。

**本仓剩下的**
- 预警线（320 行 / 上限 400）上的三个文件：`signaling/connection.ts` 382、
  `state/roomMachine.ts` 339、`call-uikit-react/src/state/callView.ts` 328。
  **下一次动它们时先拆**。
  （`engine.ts` 这轮拆完了：`media/mediaPlane.ts` 收候选进出与远端轨道落地，
  `frameLoop.ts` 收「输入进状态机 → 发帧 → 应答回喂」这条核心循环连同状态机快照；
  门面剩 279 行，只管对宿主的那张 API 表。）
- Demo 还没演示的：**主动换设备**、双击放大某一格。
- 弱网表现没测过（Chrome 限速对 WebRTC 的 UDP 无效，得靠服务端的 `scripts/weaknet.sh`）。
- Safari 没测过（simulcast 与 H.264 行为与 Chrome 不同）。
- uikit 还没做：双击放大某一格（`focusedLayer` 已备好但没接界面）、屏幕共享（MVP 不做）。

## 已知坑 / 限制

- **发送侧的默认值陷阱（各端都会踩，已写进协议 §2.4）**：「省略即取默认值」只对**真的省略**
  成立。`JSON.stringify` 会把显式的 `false`/`0` 编码出去——直接写 `{room_id:'r-1'}` 少了
  `auto_subscribe`，写 `auto_subscribe:false` 又把默认的 `true` 覆盖掉，**两种写法都会让人
  进了房收不到任何流**。发送侧一律用 `newFrameData(FIELDS)` 起手再改字段。
- **协议里三处与旧草案不同**：下行 `timeout` → `call.no_answer`；草图 §09 的 `room_ready` →
  `call.connected`；**Engine 状态机没有 `ended` 状态**（ended 是事件，草图里停 1.5s 的
  方框是 uikit 的展示状态）。
- **便利事件只在 1v1 抛**（`onCallCancelled/Rejected/Busy/NoAnswer`）；群通话只抛 `onUser*`，
  否则违反「便利事件后必定跟 onCallEnd」。
- **`getUserMedia` 只在 localhost / HTTPS 可用**。Demo 页面底部要写明；公网联调必须 HTTPS。
- **Safari 与 Chrome 的 simulcast / H.264 行为不同**：按实测处理并写进 `docs/`，不要猜。
- **时序类行为别在浏览器里靠肉眼判断**：面板隐藏时 `document.hidden=true`、rAF 冻结、
  程序化 `scrollTop` 不派发 scroll 事件——分不清是真 bug 还是探针死了。
  姊妹项目 im-web 为此空跑过一整轮。**一律写 jsdom 测试。**
- **effect 依赖的两个经典坑**（姊妹项目上的真实 bug）：
  ① 回调型 prop 每次渲染都是新函数，列进 deps 会无限重跑 → 走 `useRef`；
  ② 定长窗口的 `length` 恒定，靠它判断"集合变了"永远不触发 → 用内容签名。
- **刷新丢失进行中状态**：MediaStream 不能跨刷新持久化；通话中刷新即掉线，
  UI 要正确表现（重连而非假装还在）。
- **换 token 是宿主的事**（协议 §1.5：4401 = 换新票再来）。engine 只提供
  `updateToken(token)` 这个口子，**不做 token provider 回调**——那等于让 engine
  自己去宿主的账号体系要票。两个 Demo 都演示了这套处置，共用
  `demo/src/connectionGuard.ts`（框架无关，demo-react 用 `@demo/connection-guard` 别名引）：
  `disconnected(4401)` → 取新票 → `updateToken`；抛 `kickedOut` 就回登录态。
  **同一次断线只换一次票**（三次 4401 会触发三次换票，而拿回来的票是一样的）。
- **会议房空了就销毁**：最后一个人离开后房间即关（服务端日志「房间已空，已关闭」），
  所以旧房间号再「加入」会得到「房间不存在」。房间号留在输入框里是有用的
  （要发给另一个标签页），所以两个 Demo 都改成**「新建」与「加入」两个按钮**，
  不再由一个按钮按输入框空不空自己猜；REST 失败也把服务端的 `error` 文案带出来了。
- **发送侧带宽估计会把「码率低」误判成「链路窄」**（服务端侧已加拥塞证据闸）。
  本机回环上曾把所有人压到 l 层，原因只是合成视频源码率本来就低。

## 关联工程 / 常用命令

- **各端能力对照表：`../im-rtc-server/docs/CLIENT_PARITY.md`**（逐端逐特性状态的**单一真相源**，✅ 只写在那里，本文件不重复）。

- 协议契约与一致性向量：`../im-rtc-server/docs/RTC_PROTOCOL.md` 与 `../im-rtc-server/docs/conformance/`。
  **只读引用，不得单方面加字段**；改协议 = 改五个仓 + 同步向量。
- 起服务端联调：`cd ../im-rtc-server && ./scripts/dev.sh`（控制面 :8787，媒体面 UDP 7881）。
  `./scripts/e2e.sh media` 可以确认服务端这边是通的，再来排查本仓。
- 常用命令：
  ```bash
  ./scripts/install-hooks.sh                       # 新 clone 跑一次，装 pre-commit 体量门禁
  ./scripts/test.sh                                # 唯一测试入口：依赖 → 体量 → 向量可达 → tsc -b → vitest
  npx vitest run --root packages/call-engine       # 只跑 engine 测试
  npx vitest run --root packages/call-uikit-react  # 只跑 uikit 测试（jsdom）
  npm run dev                                      # 自画 UI 的 Demo（:5178）
  npm run dev:react                                # 引 uikit 的 Demo（:5179）
  RTC_CONFORMANCE_DIR=/path/to/conformance ./scripts/test.sh   # 向量不在同级目录时
  ```
