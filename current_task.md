# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：就地覆盖、不追加。历史见 `git log` 与 [current_task.archive.md](current_task.archive.md)（新的在上，顶节「2026-09-17（SDK 1.0.0 公网发布后精简）：精简前全文」）。
> 规范 [CONVENTIONS.md](CONVENTIONS.md) · 分期 server `docs/design/RTC_CALL_DESIGN.md` §10 · 发版 server `docs/ops/RELEASE.md` ·
> 界面以设计稿 **v3.1** 为准：`../im-rtc-server/docs/design/sketches/RTC_CALL_UI_SPEC.html` / `RTC_CALL_UX_FLOWS.html`。
> ✅ 状态只写在 `../im-rtc-server/docs/CLIENT_PARITY.md`。

## 当前焦点

**2026-09-17 下午：旧「下一步」2（destroy 对表）、4、5、6 四条做完并推送，`test.sh` 16 步全绿。**
- `343dcc3` 铃声 `play()` 被本端 `pause()` 打断（`AbortError`）记 debug，只有 `NotAllowedError` 才说「被拦下」。
- `a9cb938` 体量 / 日志门禁按 `package.json` workspaces 推扫描目录（`scripts/lib/workspaceDirs.sh`），demo-react 不再漏扫；读不出 workspaces 时 exit 2。
- `2b2017a` `webrtcAdapter.ts` 529 → 449（`media/videoSender.ts`、`media/captureStream.ts`）。
- `c257177` `engine.ts` 582 → 470（`callGuards.ts`、`engineSession.ts`、`engineMediaApi` 的 `openLocal` / `closeLocal`）；destroy 之后逐方法归类钉进 `test/destroyContract.test.ts`，三端对照写进 CLIENT_PARITY v1.39 `[^destroy]`（server `fd7b38d`）。
- `77146f5` demo-react 设置补「静音来电铃声」（对齐 iOS / Android Demo，接 `<CallProvider ringtoneMuted>`、存 localStorage）；勾选 + 刷新保持已验，真来电静音没点过。桌面 Demo 不放铃声，不加。
- demo-react 拨号卡片四段统一骨架（标题 / 控件行 / 说明，按钮收右侧固定宽一列），会议说明挪到会议段下；只截图量过布局，按钮没实际点、窄屏没看。
- 09-17 夜那三件（`call.ringing` 占位格、会议房 M1、网络横幅只在 1v1）见 git log，已真实验过。

## 下一步

- 09-17 下午用户验收了旧「下一步」1、2：发起人挂断后被叫能在选人页重新邀请、他那边来电页不出现自己的格子；`openMicrophone` / `openCamera` 等四个开关真浏览器点过。
  旧 3（destroy 对表查出的别端欠账）不在本仓，已挪进 android / ios 的 `current_task.md`。
- 暂无本仓待办。会议房 M1、网络质量两行 CLIENT_PARITY 仍是 🟡（09-17 夜已真实验过，改格子时一并确认）。

## 已知坑 / 限制

- **发布只能用户在终端发**：`npm publish` 要通行密钥 2FA，Claude 这边没 TTY 必报 EOTP。版本号改 `packages/call-engine/src/version.ts` + 两个 `package.json`。
- **`IMRTC_SDK` 三档只影响两个 Demo 的 `vite.config.ts`**：`tsc -b`、`vitest` 永远跑源码。`local` / `public` 档目录不存在时直接抛错（不回落 source），先跑 `./scripts/pack-sdk.sh <档>`（每次 `rm -rf` 重建）。
- `check-logging.sh` 靠 `*/vite.config.ts` 豁免才不拦两个 Demo `vite.config.ts` 的构建期 `console.log`，改豁免表别删这条。两道门禁扫哪些目录跟 `package.json` 的 workspaces 走，别再手写列表。
- **LICENSE 每个包目录下都要有一份**：npm 只打包包自己目录里的 LICENSE，monorepo 根那份不跟着进去。
- **`callCancelled` 公开事件字段是 `uid`，线路帧 / 状态机内部仍是 `by`**（向量钉死）：翻译只在 `engineBus.ts` 的 `emitMachine` 那条特例。
- **`destroy()` 之后不是一刀切**：发起类抛 2005，`logout()` / `forceEnd()` / `on()` / `close*` / 读或清理类始终安全。**新公开方法必须归进 `test/destroyContract.test.ts` 的 THROWS / SAFE**，不归类那条用例就红。
- **「发布过没有」只问 `MediaAdapter`**（`publishedMicrophoneCid()` / `publishedCameraCid()`），别在 `engine.ts` 另记账。
- **`FrameLoop.sendFrame` 从不把服务端拒绝转成异常**：`call()` / `joinCall()` / `inviteMore()` 被拒也 `resolve`，失败看 `error` 事件与状态机落地，别用 `try/catch` 猜。
- **2006 阈值「3」未校准、uikit 只认 2 个错误码**：见 server「已知坑」。
- **关摄像头停采集**：通话中关 = `track.stop()`，开 = 重新 `getUserMedia` 再 `replaceTrack` 到同一个 sender；开关串行（`cameraToggle`）；`stopLocalPreview()` 不停 `cameraClaimed` 的。
- worktree 不在 `.claude/worktrees/` 下时直接 `npx vitest` 找不到向量：设 `RTC_CONFORMANCE_DIR`，或走 `./scripts/test.sh`。
- **对端重开摄像头要等新帧上屏才揭示**：等待时 `<video>` 保持可见、靠头像盖住（`visibility:hidden` 可能不回调 rVFC）；rVFC 回调了不等于新画面，要按 `receiveTime` 挡掉积压旧帧；后台标签页 2 秒兜底。
- **「人先进来、轨道后到」是常态**：挂载时的 effect 依赖数组得带 `hasVideo`。
- 权限状态查询只决定要不要出说明卡，判失败靠真探。Safari `getUserMedia` 必须在用户手势调用栈里，中间不能夹网络 `await`。
- **没挂元素的人就是彻底静音**：语音版式、页内小窗、第 9 人起的声音全靠 `RemoteAudioSink`，别删；一个 uid 只挂一个元素。
- **中间态一定要有回滚**：帧发不出去或被拒时状态机必须收到 `*_failed`（表在 `frameLoop.rollback`，与 Android `onRequestFailed` 对齐）。
- 解不动的下行帧按原始 data 放行、绝不往上抛；下行 call 帧必须按 call_id 过滤。
- **停 Demo 用 Ctrl+C，别用 Ctrl+Z**（挂起的 vite 占着端口）；走 `./scripts/dev.sh` 会自动回收。
- jsdom 25 没有 `PointerEvent`、容器 0×0；**fake timers 下纯 `await Promise.resolve()` 不会让 `setTimeout(fn, 0)` 落地**，用 `vi.advanceTimersByTimeAsync`；真实定时器下用 `await new Promise((r) => setTimeout(r, 0))`。
- `getUserMedia` 只在 localhost / HTTPS 可用；便利事件只在 1v1 抛，群通话只抛 `onUser*`。
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
