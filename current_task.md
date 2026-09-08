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

**补上跨端 review 的最后一条：`resumeRoom` 无条件推 joined（2026-09-08）**，
`./scripts/test.sh` 十三步全绿（engine 288 / uikit 105）。
分支 `fix/parity-recovery-0908`（worktree `../wt-web-review-fixes`）。

那一轮 review 在 iOS/Android 上抓到三条「某一帧被拒之后没人收场」，本仓的
`9ddc6d2`（13 条那一刀）已经顺手带掉了其中两条——`room.leave → leave_failed`、
`call.accept` / `call.join → call_failed`，改法与另外两端一致。**只剩这一条。**

### 症状

`disconnected` 会把**任何**非 idle 状态推进 `reconnecting`，`joining` 也在内。
而从 `joining` 断的那一种，`room.join` 当时还在飞：服务端从没受理过我们，
恢复的只是那条 WS 会话，**不是房间成员关系**。原先 `resumeRoom` 无条件宣布 `joined`：

- 本端以为自己在房里 → 之后每一帧都换回 1201/1203；
- 重新 join 又因为「不在 idle」被本地拒成 2005；
- 一个哑掉的死局，**日志里一条报错都没有**。

### 本端踩得比另外两端更稳

`handleClose` 是**同步**调 `onDisconnected` 的，而 `dispatch` 头一行就同步 reduce；
`rejectAll` 触发的 `join_failed` 只能等微任务。所以 `disconnected` **每次都赢**，
那条本该兜住它的 `join_failed` 必定变成空操作（它 guard 在 `joining` 上，状态早被推走了）。
**iOS 那边是竞态、这里是稳定复现**——所以判据不能靠时序。

### 改法（四端同一份）

`RoomContext` 加 `didJoin`，**只由 `room.join.ok` 置位**（`roomRecv.ts` 的 `handleJoinOk`）。
`resumeRoom` 据它分辨来路：真进过房才回 `joined`，否则走 `rejoin()`——
**重发一次 `room.join`**（房号、房票、`auto_subscribe` 都还在手上，攒下的意图照旧留着重放）。
连房号都没有（join 的帧还没产出就断了）就干净地回 idle，不发帧。

**向量没动**：两条 reconnect 向量的初始态都是 `room: joined`，`didJoin` 影响不到它们。
向量跑法里补了一句种子（初始就在房里的把 `didJoin` 一起置上）——
**是种子不完整，不是实现变了**。

**新增 7 条用例**（`test/roomResume.test.ts`）。把 `resumeRoom` 里那行 `didJoin` 判断
删掉注回旧逻辑，其中 4 条立刻红（重发、意图留存、auto_subscribe、无房号回 idle），
另外 3 条是护栏（从 joined 恢复、resumed=false、join.ok 置位），本就不该被这个注入影响。

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
