# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：就地覆盖、不追加。历史见 `git log` 与 [current_task.archive.md](current_task.archive.md)（新的在上，顶节「2026-09-17 傍晚（/simplify 清理收口时移出活快照）」，其下是「SDK 1.0.0 公网发布后精简：精简前全文」）。
> 规范 [CONVENTIONS.md](CONVENTIONS.md) · 分期 server `docs/design/RTC_CALL_DESIGN.md` §10 · 发版 server `docs/ops/RELEASE.md` ·
> 界面以设计稿 **v3.1** 为准：`../im-rtc-server/docs/design/sketches/RTC_CALL_UI_SPEC.html` / `RTC_CALL_UX_FLOWS.html`。
> ✅ 状态只写在 `../im-rtc-server/docs/CLIENT_PARITY.md`。

## 当前焦点

**2026-09-18：会议房 M2 真机 / 浏览器验收进行中。M2 的 Engine 与 uikit 两段已在 09-17 夜～09-18 凌晨做完（`389e3af` / `544d4f1`，见 server `docs/design/MEETING_ROOM_DESIGN.md` §7 第 2、5 步）。今天全是联调才暴露的修复，`test.sh` 16 步全绿。**

- **退订再重订之后画面定格**（`1d6fb12`）：M2 第一次让「退订→重订」成为常规动作，
  协议 `track_id` 不变但媒体层拿到的是**新的轨道对象**，而 `ViewRegistry.addTrack` 只往 uid 的
  `MediaStream` 上加、不摘已经 `ended` 的那条（退订不会让 `remoteTracks` 少一条，对账扫不到），
  `<video>` 于是一直播第一条。三端同病。
  **顺带修了一条一直在空跑的老用例**：`fakeTrack` 没有 `kind`，2.0.0「音频不进画面流」那条分支
  从没被测到，补上 `kind` 当场变红。
- **成员列表摄像头图标出界 + 页码压在九宫格上**（`f87913c`）：`sheetRow` 缺 `boxSizing`、
  页码是 absolute 定位。改成 `flex` 排在网格下方，量尺寸的 ref 从 stage 挪到 grid。
- **标题栏改成写房号、点一下复制 + 小格子名字牌换紧凑档**（`90d004e`）：人数只留右上角「👥 N」；
  底部条 84px 的格子里名字只剩 29px，连 `carol` 都放不下，`compact` 由调用方给
  （React 侧知道底部条恒是 84px，不必上 ResizeObserver）。剪贴板用不了时也要提示，别静默。

**浏览器验过**：翻走 >10 秒再翻回画面恢复且**持续解码**（`getVideoPlaybackQuality` 3 秒 +90 帧，
每条流只挂一条 `live` 轨道）；新标题栏；成员列表与页码。

**服务端侧与本端相关的一条**（已修，见 server `current_task.md`）：编解码裁剪不幂等，
Web 发 VP8 而 iOS 发 H.264，一间混着两种端的会议里必然有人永远黑屏。

**待决**：Web 要不要也默认发 H.264（`../im-rtc-server/docs/mechanism/VIDEO_CODECS.md` §5，
要先实测 `encoderImplementation` 与 CPU）。

**2026-09-17 夜：信令层一次性定时器抽成 `signaling/oneShotTimer.ts`（队列 5 的定时器样板，不导出）**：`Reconnector` / `ResumeDeadline` 改用它；`Heartbeat`（周期）、`TokenExpiryTimer`（注入定时器 + 32 位分段）、`PendingRequests`（按 req 多只）形状不同，没动。行为不变。

**2026-09-17 夜：「调用结果回给调用方」（server `docs/design/ACTION_RESULT_DESIGN.md`，→ 2.0.0）已提交 `7089978`（未推送），code-review 已过。** `test.sh` 16 步全绿。
- 向量：`act` 步骤新增 `result`，状态机本地拒绝不再 emit `onError`（`MachineOutput.reject`），两个 FSM runner 比对它。
- `FrameLoop.request`（宿主调用）/ `dispatch`（找不到调用方）分开：直接帧失败 reject 给调用方、不发 `error` 事件；直接帧 `.ok` 落进状态机就结算，连锁帧失败走 `error`（带 `forType`）。退出类（hangup / reject / cancel / leave）失败本地收场。
- 门面：`call()` 返回 `callId`；`probe*` 不再双发；`setRemoteLayer` / `close*` 永不 reject；`setRemoteLayer` 归 destroy 后 SAFE。`error` 事件加 `forType`。
- uikit：删 `joinCall` 临时监听与 `subscribeEngine` 的 `error` 订阅；拨号 1409、加人 1202/1407/1409、主动加入从 reject 取码；其余 catch 只留日志。
- 新测 `test/actionResult.test.ts`（11 个方法 × 四格 + 连锁帧 / 退出类 / 提示类）。

## 下一步

- 09-17 下午用户验收了旧「下一步」1、2：发起人挂断后被叫能在选人页重新邀请、他那边来电页不出现自己的格子；`openMicrophone` / `openCamera` 等四个开关真浏览器点过。
  旧 3（destroy 对表查出的别端欠账）不在本仓，已挪进 android / ios 的 `current_task.md`。
- 真机验收后等用户通知发 2.0.0：版本号改 `packages/call-engine/src/version.ts` + 两个 `package.json`，用户在终端 `npm publish`。
- 真机（Chrome 5179）：`joinCall` 满员 1202 / 已结束 1402 / 宿主拒绝 1409 三种文案；拨号拿到 `callId`；通话中断网再挂断界面收得掉。

## 已知坑 / 限制

- **发布只能用户在终端发**：`npm publish` 要通行密钥 2FA，Claude 这边没 TTY 必报 EOTP。版本号改 `packages/call-engine/src/version.ts` + 两个 `package.json`。
- **`IMRTC_SDK` 三档只影响两个 Demo 的 `vite.config.ts`**：`tsc -b`、`vitest` 永远跑源码。`local` / `public` 档目录不存在时直接抛错（不回落 source），先跑 `./scripts/pack-sdk.sh <档>`（每次 `rm -rf` 重建）。
- `check-logging.sh` 靠 `*/vite.config.ts` 豁免才不拦两个 Demo `vite.config.ts` 的构建期 `console.log`，改豁免表别删这条。两道门禁扫哪些目录跟 `package.json` 的 workspaces 走，别再手写列表。
- **LICENSE 每个包目录下都要有一份**：npm 只打包包自己目录里的 LICENSE，monorepo 根那份不跟着进去。
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
