# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：就地覆盖、不追加。历史见 `git log` 与 [current_task.archive.md](current_task.archive.md)（末节「2026-09-11 精简前全文」）。
> 规范 [CONVENTIONS.md](CONVENTIONS.md) · 分期 server `docs/design/RTC_CALL_DESIGN.md` §10 ·
> 界面以设计稿 **v3.1** 为准：`../im-rtc-server/docs/design/sketches/RTC_CALL_UI_SPEC.html` / `RTC_CALL_UX_FLOWS.html`。
> ✅ 状态只写在 `../im-rtc-server/docs/CLIENT_PARITY.md`。

## 当前焦点

**Web 看对端重开摄像头「刷新一闪」——已提交 `e447276`，用户 2026-09-11 21:11 浏览器验过**（web bob 看 iOS carol / Android alice；Android 同一问题 20:04 真机已验好）。

- 20:45 复测第一版仍闪：日志里 `wait_ms` 7 / 20 / 29（一两个刷新周期），早于 iOS 本端首帧（开后约 180ms）——rVFC 报的是关时藏起来、积压没上屏的旧帧，一可见就补上屏。
  排除了换层（iOS 只推 h 层）、分辨率变化（恒 720×1280）、重挂 srcObject（挂载 effect 不依赖 hasVideo）。
  第二版：`FirstFrameGate.isStale` 只认 `receiveTime` 晚于 `armedAt` 的帧，没有 receiveTime 就等 `mediaTime` 变；落定日志带 `skipped` / `judged_by` / `received_ago_ms`。

- 根因：关摄像头走 `room.track_muted`，轨道不摘、`<video>` 整通复用，元素上留着关之前的最后一帧；`firstVideoFrame` 按轨道只抛一次（日志里 carol 开关约 10 次、首帧只 1 次），uikit 按 `userVideoAvailable(true)` 立刻揭示 → 先露旧画面、几百毫秒后换新画面。
- 改法：engine `frameLoop.ts` 的 `videoTurnedOn` → `MediaBridge.awaitFirstVideoFrame` → `media/firstFrameGate.ts` 的 `FirstFrameGate`（`requestVideoFrameCallback` 等新帧上屏）再抛一次 `firstVideoFrame`；
  uikit `RemoteParticipant.isVideoPending`（`state/participants.ts` 的 `setVideo` / `revealVideo`），`VideoTile` 等待时头像盖在**仍可见**的 `<video>` 上，`useVideoRevealFallback` 2 秒兜底。
- 日志关键字：`远端开摄像头后新画面上屏`（带 `wait_ms`）/ `浏览器报不了画面上屏，开摄像头即揭示` / `新画面迟迟没上屏，到点照样揭示`。
- 用例：engine `test/firstFrameGate.test.ts`，uikit `test/videoReveal.test.tsx`。

**测之前先重起 vite**：uikit 按 `dist/` 被 demo 消费，不重起还是旧的（有一轮就这么白测了）。

## 下一步

- 首帧闸门 21:11 实测：`wait_ms` 232–910、`judged_by` 全是 `receive_time`、两次 `skipped=1`；以后再报闪先看这三个字段，常撞 2 秒兜底就查后台标签页 / 对端迟迟不出关键帧。
- 静默失败点清单（P0×3 / P1×7 / P2×7）：`../im-rtc-server/docs/ops/silent-failure/web.md`，逐条状态只在那里。
  未修头两条：§A 发布 / 订阅被拒没有收场路径（四端同源）、呼出阶段按静音只改 UI 对方仍听得见。
- 跨端老批次（含本端「挂断后再邀请回来看得到画面」）清单见 `../im-rtc-server/current_task.md`「跨端待验」。
- `getUserMedia` 那类失败仍可能静默：日志回传够不到浏览器 console。
- `CLIENT_PARITY.md` 真机验完再改。

## 已知坑 / 限制

- **2006 阈值「3」未校准、uikit 只认 2 个错误码**：见 server「已知坑」。
- **关摄像头停采集**：通话中关 = `track.stop()`，开 = 重新 `getUserMedia` 再 `replaceTrack` 到同一个 sender（transceiver / msid / cid 不变、不重协商）；开关串行（`cameraToggle`），`close()` 后才回来的按代数自己收摊；
  重新采集被拒时错误原样抛给调用方。`stopLocalPreview()` 不停 `cameraClaimed`（正在发布 / 已发布）的；等在起的那次落地再停，期间又有人要预览就听后来的（`previewIntent`）。
- worktree 不在 `.claude/worktrees/` 下时，直接 `npx vitest` 找不到向量（抛错不读错）：设 `RTC_CONFORMANCE_DIR`，或走 `./scripts/test.sh`。
- **对端重开摄像头要等新帧上屏才揭示**：`requestVideoFrameCallback` 对 `visibility:hidden` 的元素可能不回调，所以等待时 `<video>` 保持可见、靠头像盖住，别改成藏起来；
  浏览器没有这个 API 就立刻揭示（退回旧行为）；后台标签页不出帧靠 2 秒兜底；首次进房也走同一道闸。
  **rVFC 回调了不等于新画面**：关时藏起来的元素积压着没上屏的旧帧，一可见就补上屏，必须按 `receiveTime` 挡掉。
- **「人先进来、轨道后到」是常态**：挂载时顺手做一次的 effect（层上报、尺寸、订阅）依赖数组里得带 `hasVideo`（`VideoTile` 已补）。
- 权限状态查询只决定要不要出说明卡，判失败一律靠真探（合成媒体源下浏览器说「已拒绝」其实拿得到）。
- Safari 的 `getUserMedia` 必须在用户手势调用栈里：「点接听 → 先探设备 → 再发 accept」，中间不能夹别的 `await` 网络请求。
- **没挂元素的人就是彻底静音**：语音版式、页内小窗、九宫格第 9 人起的声音全靠 `RemoteAudioSink` 的隐藏 `<audio>`，别删。
  一个 uid 只能挂一个元素，画了格子的人不要再给 sink；别让「谁上格子」跟着 `activeSpeakers` 抖（每抖一次一次 `srcObject` 重挂）。
- **中间态一定要有回滚**：帧发不出去或被拒时状态机必须收到 `*_failed`，否则停在转圈屏、之后每个动作 2005。表在 `frameLoop.rollback`，与 Android `onRequestFailed` 逐条对齐。
- 解不动的下行帧按原始 data 放行、绝不往上抛（抛在 `PendingRequests.settle` 里 `request()` 的 promise 永不落定）。
- 下行 call 帧必须按 call_id 过滤（第三方呼叫的 `call.ended{busy}` 带新来那通的 id）。
- **停 Demo 用 Ctrl+C，别用 Ctrl+Z**：挂起的 vite 占着端口不响应（"Port is already in use"、curl 零字节超时），只能 `kill -9 -<pgid>`。走 `./scripts/dev.sh` 会自动回收。
- jsdom 25 没有 `PointerEvent`（`test/setup.ts` 用 `MouseEvent` 垫）；jsdom 里容器是 0×0，拖动用例只验逻辑不验坐标。
- `getUserMedia` 只在 localhost / HTTPS 可用，公网联调必须 HTTPS。
- 便利事件只在 1v1 抛，群通话只抛 `onUser*`；加人失败靠 `error` 事件的 1202 / 1407。
- effect 依赖看内容签名不看 length（`settledUids`）；回调型 prop 走 `useRef`。
- 状态机 `args` 一律 snake_case（与向量、另外三端同名），转 camelCase 是 `engineBus` 的活。
- `packages/call-engine/src/` 里不能放 `*.test.ts`（会被 `tsc -b` 算进 build），测试放 `test/`。
- 换 token 是宿主的事（协议 §1.5），engine 只提供 `updateToken`；发送侧一律 `newFrameData(FIELDS)` 起手（§2.4 默认值陷阱）。
- 画质是宿主策略（`videoProfile`），改档位同步服务端 `bwe.go` 的 `bitrateHigh`。
- SDK 版本号改 `packages/call-engine/src/version.ts`（`SDK_VERSION`）+ 两个 `package.json`（五端统一 1.0.0，握手 `web/1.0.0`）。
  demo-react 设置存 localStorage（双开共用），登录态仍是 sessionStorage；它的 vitest 已进 test.sh，但**体量门禁与日志门禁都不扫 `demo-react/`**（老漏洞，未修）。

## 关联工程 / 常用命令

- 协议契约与一致性向量：`../im-rtc-server/docs/RTC_PROTOCOL.md` 与 `../im-rtc-server/docs/conformance/`，只读引用。
- 起服务端联调：`cd ../im-rtc-server && ./scripts/dev.sh`（控制面 :8787，媒体面 UDP 7881）。
- 浏览器实测：两个标签页各登一个用户并**勾上「合成音视频源」**（Browser 面板里拿不到真麦克风）。
  ```bash
  ./scripts/install-hooks.sh                       # 新 clone 跑一次
  ./scripts/test.sh                                # 唯一测试入口（14 步）
  npx vitest run --root packages/call-engine       # 只跑 engine 测试
  npx vitest run --root packages/call-uikit-react  # 只跑 uikit 测试（jsdom）
  npm test                                         # = 上面两条；根目录不能裸跑 vitest
  npm run dev                                      # 自画 UI 的 Demo（:5178），前台
  npm run dev:react                                # 引 uikit 的 Demo（:5179），前台
  ./scripts/dev.sh [start|stop|status|logs] [demo|react]   # 后台起停，先杀后起、幂等，日志进 dev-logs/
  ```
