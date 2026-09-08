# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：只记当前状态，**就地覆盖、不追加**。历史见 `git log` 与
> [current_task.archive.md](current_task.archive.md)（只读归档，2026-09-05 搬入）。
> 工程规范见 [CONVENTIONS.md](CONVENTIONS.md)；方案与分期见 `im-rtc-server` 的
> `docs/design/RTC_CALL_DESIGN.md` §10；**界面以设计稿 v3 为准**：
> `../im-rtc-server/docs/design/sketches/RTC_CALL_UI_SPEC.html`（令牌 / 图标 / 组件红线）与
> `RTC_CALL_UX_FLOWS.html`（权限 / 小窗 / 互换 / 加人）。**两稿已升到 v3.1**——
> v3.1 推翻了 v3 的六条（小窗入口、视频版式退化、小窗挂断、呼叫页标题、Android 画中画与全屏），
> 冲突时以 v3.1 为准。

## 当前焦点

**`/code-review high` 的 13 条一次修完（2026-09-08）**，在 worktree `../wt-web-review`
（分支 `fix/review-11`）上做，`./scripts/test.sh` 十三步全绿。**没上浏览器，没真机。**

其中 11 条是本仓自审出来的，另外 2 条是 iOS 评审在 `IMFrameLoop` 上发现、
本仓一模一样也有的（`leave_failed` 与 `accept/join` 不回滚）。

| # | 症状 | 改在哪 | 三端情况 |
|---|---|---|---|
| 1 | 坏应答帧解码抛错 → `request()` 永不落定，房间永停 `joining`，宿主一条错都收不到 | `connection.decodeData` 解不动就按原始 data 放行 | iOS/Android 本来就有兜底，**只有本仓漏了** |
| 2 | 没连接时帧被静默丢弃、状态机卡死（未登录就 `call()` → 永停 `inviting`） | `frameLoop.sendFrame` 回 `2007` 并走 `rollback` | **iOS 同病**；Android 早就是对的，照抄它 |
| 3 | `login()` 不关旧连接 → 假 `kickedOut`，旧 `ResumeDeadline` 75s 后杀掉**新**会话 | `login()` 已连接就拒，失败收摊 | iOS 早修过并留了注释，本仓是没跟上的那个 |
| 4 | `resumed=false` 静默清房、一个事件都不抛 → 会议界面永远显示「会议中」，媒体面不归零 | `engineMachine.dropLostSession` 没 call 时补 `onRoomLeft` | **三端同源，iOS/Android 都没修** |
| 5 | `room.leave` 被拒无回滚 → 房间永停 `leaving`，**摄像头指示灯一直亮** | 新增 `leave_failed` | iOS 同病；Android 有 |
| 6 | `call.accept`/`call.join` 被拒无回滚 → 滞留 `accepting`，来电屏没有出口 | `rollback` 表加这两个 type | iOS 同病；Android 有 |
| 7 | `ViewRegistry.removeTrack` 从未接线 → 退订的轨道留在 `MediaStream` 上 | `MediaBridge.syncRemoteTracks` 双向对账 | Android 干净；iOS 是另一种形态（重复 sink） |
| 8 | `joinMeeting` 先置界面态，`joinRoom` 同步抛 1004 后卡死、拨号面板全禁 | 只包 `joinRoom` 那一句，失败 `dismiss` 并重抛 | 本仓独有（那两端 `joinRoom` 不校验也不抛） |
| 9 | 麦克风推流失败成 unhandled rejection，**声音画面一起丢**且零提示 | `publishFor` 接住麦克风那半，出提示后继续推摄像头 | iOS 是弱化版（`try?` 吞掉，同样没提示） |
| 10 | 九宫格截断的人**连声音一起没了**（会议第 9 人起） | `GridStage` 给 offscreen 的人补 `RemoteAudioSink` | 本仓独有（那两端远端音频不绑视图） |
| 11 | 小窗跟着主讲人换 → 每 300ms 重挂两个人的 `srcObject`，音频断续 | 小窗固定画 `participants[0]` | 本仓独有（那两端浮窗不挑主讲人） |
| 12 | `tokenExpiry` 延时超 2^31 溢出 → 长有效期票每次握手都误报一次 | 分段续排 | 本仓独有（Int64 / Long 没这个坎） |
| 13 | 根 `npm test` 把 uikit 用例塞进 node 环境跑，红 63 条 | 拆成 `test:engine` + `test:uikit` | 不适用 |

**新增用例 21 条**（`failureRecovery.test.ts` 7 + engineMachine 6 + viewRegistry 3 +
tokenExpiry 2 + meeting 2 + interactions 2）。第 10、11 条**注入旧实现验过载重**——
换回原样后那两条立刻红。

**没做**：iOS 与 Android 的第 4 条（三端同源那个）**没动那两个仓**，
`IMRoomMachine.resume` 两处都要补同样的 `onRoomLeft`；iOS 的第 2/5/6 条同理。
`CLIENT_PARITY.md` 也没更新。

## 下一步

- **浏览器复测**：九宫格这一批（三格是不是「第一行两个」、加号格真的没了、群呼选人能勾能拨）+ 上一轮的五条（通话中来电只出提示、群通话被叫也有占位格、两端关摄像头
  小窗仍在、加人真的能加进来、发起人挂断后其余人继续）+ 上一轮欠的四条
  （开摄像头失败的降级、加人被拒后占位格收回、提示 3s 自撤、小窗首帧不从左上角弹出去）。
- iOS / Android 已按同一份稿落地（见各自的 `current_task.md`），**都还没真机验**。
- Demo 还没演示的：主动换设备、桌面独立窗口（那是 desktop 仓的事）。
- **体量阈值已由 400 抬到 600**（2026-09-08，按语言与其余四端对齐，理由见 CONVENTIONS §2）；
  预警线随之是 480，当前最大的 `signaling/connection.ts` 405，**一条预警都没有**。
  抬阈值前先按规矩拆了 `engine.ts`（400 → 353，接线与媒体编排各自成模块）——
  **顺序不能倒过来**，否则那条红线就成了摆设。

## 已知坑 / 限制

- **「人先进来、轨道后到」是常态，不是异常**：格子挂载那一刻 `useRemoteTrack` 往往还是空。
  任何「挂载时顺手做一次」的 effect（层上报、尺寸、订阅）**依赖数组里都得带上 `hasVideo`**，
  否则轨道到了不会重跑——层上界为此空转过整整一版（`VideoTile` 已补）。

- **权限状态查询只用来决定要不要出说明卡，不用来判失败。** 判失败一律靠真探：Demo 的合成媒体源不走
  `getUserMedia`，浏览器说「已拒绝」而媒体层其实拿得到——信了查询就把能打的电话拦下来（本轮实测撞到）。
- **Safari 的 `getUserMedia` 必须在用户手势的调用栈里**：接听流程是「点接听 → 先探设备 → 再发 accept」，
  中间不能夹别的 `await` 网络请求。
- **没挂元素的人就是彻底静音**——engine 只把流挂到 `attachView` 给的元素上。语音版式、
  页内小窗、**九宫格里被截断的第 9 人起**都没有格子，声音全靠 `RemoteAudioSink` 那个隐藏
  `<audio>`，别删。**一个 uid 只能挂一个元素**（后挂的顶掉先挂的），所以画了格子的人不要再给 sink，
  也别让「谁上格子」跟着 `activeSpeakers` 抖——每抖一次就是一次 `srcObject` 重挂。
- **中间态一定要有回滚**：帧发不出去（没连接）或被服务端拒掉时，状态机必须收到对应的
  `*_failed`，否则界面停在转圈屏、之后每个动作都被拒成 2005。表在 `frameLoop.rollback`，
  与 Android 的 `onRequestFailed` 逐条对齐。
- **解不动的下行帧按原始 data 放行，绝不往上抛**：抛在 `PendingRequests.settle` 里会让
  `request()` 的 promise 永不落定（waiter 已摘、超时已清）。
- **jsdom 25 没有 `PointerEvent`**：`test/setup.ts` 用 `MouseEvent` 垫了一个，只补手势层读到的字段。
  jsdom 里容器量出来是 0×0，拖动用例只验「拖了 → 吸角 → 不互换」这条逻辑，不验坐标。
- **`getUserMedia` 只在 localhost / HTTPS 可用**；公网联调必须 HTTPS。
- **便利事件只在 1v1 抛**；群通话只抛 `onUser*`。加人的失败分支靠 `error` 事件的 1202 / 1407。
- **effect 依赖看内容签名不看 length**（`settledUids` 就是这么写的）；回调型 prop 走 `useRef`。
- **下行 call 帧必须按 call_id 过滤**：通话中被第三方呼叫时服务端发来的 `call.ended{busy}`
  带的是**新来那通**的 call_id，不过滤就会把正在进行的通话拆掉（iOS 真机 08:30:39 实测）。
- **状态机的 `args` 一律 snake_case**（与向量、与另外三端同名），转 camelCase 是 `engineBus` 的活。
- **`packages/call-engine/src/` 里不能放 `*.test.ts`**（会被 `tsc -b` 算进 build）。测试一律放 `test/`。
- **换 token 是宿主的事**（协议 §1.5）；engine 只提供 `updateToken`。
- **画质是宿主策略**（`videoProfile`），改档位要同步服务端 `bwe.go` 的 `bitrateHigh`。
- 发送侧一律用 `newFrameData(FIELDS)` 起手（协议 §2.4 的默认值陷阱）。

## 关联工程 / 常用命令

- **各端能力对照表：`../im-rtc-server/docs/CLIENT_PARITY.md`**（✅ 只写在那里，本文件不重复）。
- 协议契约与一致性向量：`../im-rtc-server/docs/RTC_PROTOCOL.md` 与 `../im-rtc-server/docs/conformance/`，只读引用。
- 起服务端联调：`cd ../im-rtc-server && ./scripts/dev.sh`（控制面 :8787，媒体面 UDP 7881）。
- 常用命令：
  ```bash
  ./scripts/install-hooks.sh                       # 新 clone 跑一次
  ./scripts/test.sh                                # 唯一测试入口（13 步）
  npx vitest run --root packages/call-engine       # 只跑 engine 测试
  npx vitest run --root packages/call-uikit-react  # 只跑 uikit 测试（jsdom）
  npm test                                         # = 上面两条；根目录没有 vitest 配置，不能裸跑 vitest
  npm run dev                                      # 自画 UI 的 Demo（:5178）
  npm run dev:react                                # 引 uikit 的 Demo（:5179）
  ```
- 浏览器实测要点：两个标签页各登一个用户并**勾上「合成音视频源」**（Browser 面板里拿不到真麦克风）。
