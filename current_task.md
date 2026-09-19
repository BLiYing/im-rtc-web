# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：就地覆盖、不追加。历史见 `git log` 与 [current_task.archive.md](current_task.archive.md)（新的在上，顶节「2026-09-19（快照整理时移出活快照）」是 09-18 与 09-17 夜的焦点原文；其下「2026-09-17 傍晚（/simplify 清理收口时移出活快照）」，其下是「SDK 1.0.0 公网发布后精简：精简前全文」）。
> 规范 [CONVENTIONS.md](CONVENTIONS.md) · 分期 server `docs/design/RTC_CALL_DESIGN.md` §10 · 发版 server `docs/ops/RELEASE.md` ·
> 界面以设计稿 **v3.1** 为准：`../im-rtc-server/docs/design/sketches/RTC_CALL_UI_SPEC.html` / `RTC_CALL_UX_FLOWS.html`。
> ✅ 状态只写在 `../im-rtc-server/docs/CLIENT_PARITY.md`。

## 当前焦点

- **09-19 新增 `engine.fetchCallHistory({limit, cursor})`**（`callHistory.ts`，`GET /v1/calls`，游标翻页，`nextCursor` 为 `null` 即到底，只返回本人）：`callHistory.test.ts` 过、`./scripts/test.sh` 16 步全绿；demo-react 通话记录改成调它（加「加载更多」），`demo/src/api.ts` 里的 `listCalls` / `CallRecord` 已删。**Chrome 里验过**（bob：首页 20 条、点一次追加到 40）。；记录页版式对齐 Android（图标 | 名字+「来电/呼出 · 结果」| 时间），时间走 `historyTime.ts`（今天 `HH:mm` / `昨天 HH:mm` / `M月d日 HH:mm` / `yyyy年M月d日 HH:mm`，8 条用例 `historyTime.test.ts` 过，Chrome 里看过版式）。

**2026-09-19：两处「判死 / 挂起」缺陷修完，真浏览器已验（Chrome × PKD130，`delay` + `silence` 注入），已推送。**
- **发布没等到应答不再判死**（`fdd9ebd`）：`room.publish` 报 2003 / 2004 / 2007 时，通话与会议房都发 `publish_deferred`，挂起等重连、恢复后原样补发（对齐 iOS）；服务端真拒仍按 R4 收场。向量 runner 支持 internal `args`。
- **判死从来没关掉过连接**（`deb7288`）：心跳 / 探测判死调 `close(1001)`，浏览器只认 1000 或 3000–4999，每次抛 `InvalidAccessError`，连接没关也不重连，只能等服务端读超时。
  现改为就地收场、**不带码关**（线上 1005，服务端按掉线留恢复窗口；1000 不行，那是 logout）。假 WebSocket 改成照浏览器规矩校验关闭码——原先它什么都收，所以单测一直绿。
  另：握手超时那条旧 socket 没关，迟到的 `onclose` 会把新连接当成断了；换 socket 前先摘回调、关掉，`onclose` 只认当前 socket。
- **心跳判死 `>` 改 `>=`**：原先第 4 个周期（60 s）才判死，与 iOS / Android / 桌面 / 服务端的 45 s 不齐；新测 `test/heartbeat.test.ts`，`connection.test.ts` 那条旧用例原先断言的正是 4 个周期。
- **回前台 / 网络变化立即重连**（09-18 晚，`f4bdd4b`）：engine 自己听 `visibilitychange` / `online` / `navigator.connection`（`browserSignals.ts`），宿主不用写；两次至少隔 2 s。状态见 CLIENT_PARITY `[^netchange]`。

**已收口（细节在 archive「2026-09-19」节）**：会议房 M2 联调三处修复（退订再重订画面定格、成员列表图标与页码、标题栏写房号 + 小格子紧凑名字牌），浏览器验过；
09-17 夜的「调用结果回给调用方」（`7089978`）与信令定时器抽取，均已推送、code-review 已过。**没验**：会议房 25 人、断网恢复。

**待决**：Web 要不要也默认发 H.264（`../im-rtc-server/docs/mechanism/VIDEO_CODECS.md` §5，要先实测 `encoderImplementation` 与 CPU）。

## 下一步

- **`ping_interval_sec` 钳到 [5,60]（缺省 / 非正数按 15）**：Android、iOS 已做，Web 没做（`connection.ts` 把 `hello.pingIntervalSec` 原样喂给 `heartbeat.start` 与 `resumeDeadline.connected`；`Heartbeat.start` 只做了 `max(1, …)`）。做的时候配单测，并与 iOS 的 `Heartbeat.clampedIntervalSec` 同值。
- 2.0.0：真机验收后等用户通知发版：版本号改 `packages/call-engine/src/version.ts` + 两个 `package.json`，用户在终端 `npm publish`。
- 真机（Chrome 5179）：`joinCall` 满员 1202 / 已结束 1402 / 宿主拒绝 1409 三种文案；拨号拿到 `callId`；通话中断网再挂断界面收得掉。
- 会议房 25 人验收（与 server 2.0.0 回归合并做）。

## 已知坑 / 限制

- **发布只能用户在终端发**：`npm publish` 要通行密钥 2FA，Claude 这边没 TTY 必报 EOTP。版本号改 `packages/call-engine/src/version.ts` + 两个 `package.json`。
- **`IMRTC_SDK` 三档只影响两个 Demo 的 `vite.config.ts`**：`tsc -b`、`vitest` 永远跑源码。`local` / `public` 档目录不存在时直接抛错（不回落 source），先跑 `./scripts/pack-sdk.sh <档>`（每次 `rm -rf` 重建）。
- `check-logging.sh` 靠 `*/vite.config.ts` 豁免才不拦两个 Demo `vite.config.ts` 的构建期 `console.log`，改豁免表别删这条。两道门禁扫哪些目录跟 `package.json` 的 workspaces 走，别再手写列表。
- **LICENSE 每个包目录下都要有一份**：npm 只打包包自己目录里的 LICENSE，monorepo 根那份不跟着进去。
- **浏览器 `WebSocket.close(code)` 只认 1000 或 3000–4999**：别带 1001 关连接（抛 `InvalidAccessError`，连接没关）；判死一律就地收场、不带码关（线上 1005，服务端留恢复窗口），1000 是 logout 不能用。测试里的假 WebSocket 已照此校验。
- **`callCancelled` 公开事件字段是 `uid`，线路帧 / 状态机内部仍是 `by`**（向量钉死）：翻译只在 `engineBus.ts` 的 `emitMachine` 那条特例。
- **`destroy()` 之后不是一刀切**：发起类抛 2005，`logout()` / `forceEnd()` / `on()` / `close*` / `setRemoteLayer` / 读或清理类始终安全。**新公开方法必须归进 `test/destroyContract.test.ts` 的 THROWS / SAFE**，不归类那条用例就红。
- **「发布过没有」只问 `MediaAdapter`**（`publishedMicrophoneCid()` / `publishedCameraCid()`），别在 `engine.ts` 另记账。
- **（2.0.0 起）宿主调用的结果走 Promise，`error` 事件只剩找不到调用方的**：宿主调用一律走 `FrameLoop.request`，引擎自发的走 `dispatch`——走错了要么双发、要么丢结果。reject 之前 `callEnd(error)` 已经抛过，uikit 的 catch 里别再收场。
- **2006 阈值「3」未校准、uikit 只认 2 个错误码**：见 server「已知坑」。
- **关摄像头停采集**：通话中关 = `track.stop()`，开 = 重新 `getUserMedia` 再 `replaceTrack` 到同一个 sender；开关串行（`cameraToggle`）；`stopLocalPreview()` 不停 `cameraClaimed` 的。
- worktree 不在 `.claude/worktrees/` 下时直接 `npx vitest` 找不到向量：设 `RTC_CONFORMANCE_DIR`，或走 `./scripts/test.sh`。
- **对端重开摄像头要等新帧上屏才揭示**：等待时 `<video>` 保持可见、靠头像盖住（`visibility:hidden` 可能不回调 rVFC）；rVFC 回调了不等于新画面，要按 `receiveTime` 挡掉积压旧帧；后台标签页 2 秒兜底。
- **「人先进来、轨道后到」是常态**：挂载时的 effect 依赖数组得带 `hasVideo`。
- 权限状态查询只决定要不要出说明卡，判失败靠真探。Safari `getUserMedia` 必须在用户手势调用栈里，中间不能夹网络 `await`。
- **远端音频归 Engine 播，不归挂载**（2.0.0 起）：`attachView` 只管画面，`RemoteAudioSink` 已退役。别再往 uid 的 `MediaStream` 里塞音频轨——挂了 `<video>` 的人会出两份声音。一个 uid 仍只挂一个画面元素。
- **中间态一定要有回滚**：帧发不出去或被拒时状态机必须收到 `*_failed`（表在 `frameLoop.rollback`，与 Android `onRequestFailed` 对齐）。
- 解不动的下行帧按原始 data 放行、绝不往上抛；下行 call 帧必须按 call_id 过滤。
- **停 Demo 用 Ctrl+C，别用 Ctrl+Z**（挂起的 vite 占着端口）；走 `./scripts/dev.sh` 会自动回收。
- jsdom 25 没有 `PointerEvent`、容器 0×0；**fake timers 下纯 `await Promise.resolve()` 不会让 `setTimeout(fn, 0)` 落地**，用 `vi.advanceTimersByTimeAsync`；真实定时器下用 `await new Promise((r) => setTimeout(r, 0))`。
- `getUserMedia` 只在 localhost / HTTPS 可用；便利事件只在 1v1 抛，群通话只抛 `onUser*`。
- **高频事件的 reducer 没变就返回原引用**（`applySpeakers` / `applyNetwork`）：新建对象会让整棵通话 UI 每 300ms 重画。按 uid 的可取消定时器用 `useKeyedTimers`，别再手写一份。
- **demo 与 demo-react 共享代码走 `@demo/*` 别名**：加一个要同步 demo-react 的 `vite.config.ts`、`tsconfig.json`、`tsconfig.sdk-local.json`、`tsconfig.sdk-public.json` 四处。
- effect 依赖看内容签名不看 length；回调型 prop 走 `useRef`；状态机 `args` 一律 snake_case，转 camelCase 是 `engineBus` 的活。
- `packages/call-engine/src/` 里不能放 `*.test.ts`；**`test/` 不在任何 tsconfig 的 include 里**，测试假实现接口改了门禁不会提醒。
- 换 token 是宿主的事（engine 只给 `updateToken`）；发送侧一律 `newFrameData(FIELDS)` 起手。画质档位改了同步服务端 `bwe.go` 的 `bitrateHigh`。
- demo-react 设置存 localStorage（双开共用），登录态仍是 sessionStorage。

## 关联工程 / 常用命令

- 协议契约与一致性向量：`../im-rtc-server/docs/RTC_PROTOCOL.md` 与 `../im-rtc-server/docs/conformance/`，只读引用。宿主对接设计：`../im-rtc-server/docs/design/HOST_INTEGRATION_DESIGN.md`。
- 起服务端联调：`cd ../im-rtc-server && ./scripts/dev.sh`（:8787 / UDP 7881）。浏览器实测两个标签页各登一个用户并**勾上「合成音视频源」**。
  ```bash
  ./scripts/install-hooks.sh                       # 新 clone 跑一次
  ./scripts/test.sh                                # 唯一测试入口（16 步，末步 IMRTC_SDK=local 校验）
  npx vitest run --root packages/call-engine       # 只跑 engine
  npx vitest run --root packages/call-uikit-react  # 只跑 uikit
  npm run dev / npm run dev:react                  # 自画 UI Demo :5178 / uikit Demo :5179
  ./scripts/dev.sh [start|stop|status|logs] [demo|react]   # 后台起停，日志进 dev-logs/
  ./scripts/pack-sdk.sh local && npm run typecheck:sdk-local && IMRTC_SDK=local npm run dev -w demo-react    # 本地包档
  ./scripts/pack-sdk.sh public && npm run typecheck:sdk-public && IMRTC_SDK=public npm run dev -w demo-react # 公网包档（联网）
  ```
