# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：就地覆盖、不追加。历史见 `git log` 与 [current_task.archive.md](current_task.archive.md)（末节「2026-09-11 精简前全文」）。
> 规范 [CONVENTIONS.md](CONVENTIONS.md) · 分期 server `docs/design/RTC_CALL_DESIGN.md` §10 ·
> 界面以设计稿 **v3.1** 为准：`../im-rtc-server/docs/design/sketches/RTC_CALL_UI_SPEC.html` / `RTC_CALL_UX_FLOWS.html`。
> ✅ 状态只写在 `../im-rtc-server/docs/CLIENT_PARITY.md`。

## 当前焦点

**2026-09-15：红键等不到结束事件时引擎也收场（`forceEnd`）+ uikit 补红键看门狗（Web 原先没有）。未提交；`./scripts/test.sh` 全绿（14 步，engine 337 / uikit 156 / demo-react 17）；09-15 与 iOS frank、Android alice 联测验过（见下一步）。**
起因 09-13 14:53~14:58 iOS frank：接听后 room.join 晚 28.6 秒才上线路，其间按红键，call.hangup 一帧没到服务端；看门狗只收了界面，引擎留在通话与房间里，其余端一直看得见他。
iOS 已落同形状（`../im-rtc-ios/current_task.md`），形状见 server `CLIENT_PARITY.md` 的 `[^forceend]`。上一件（对端重开摄像头闪一下）已提交 `e447276`、21:11 验过。

- engine `CallEngine.forceEnd(): void`（同步、不抛）→ `FrameLoop.forceEnd`：纯函数 `state/forceEnd.ts`（`forceEnd` / `endFrames`）挑帧——通话中 hangup、响铃 reject、拨出 cancel、accepting reject+hangup、会议 room.leave；
  帧走 `Connection.fire`（不等应答、应答配对后丢掉、未连接只记日志）**不排在在途请求后面**；本地收场与发帧在同一次同步调用里（先发帧、再落状态/关媒体/抛事件），所以不需要 iOS 那种 call_id 比对。
- 迟到帧：`roomRecv.ts` idle 下 `room.join.ok` 补发 `room.leave`、其余丢弃；`callRecv.ts` idle 下 `call.invite.ok` 补发 `call.cancel`、`call.connected` 补发 `call.hangup`（拨出中没 call_id 的补救）；`frameLoop` 房间 idle 时丢迟到的候选 / SDP。
- `请求往返慢`（≥ 2000ms，`type` / `elapsed_ms` / `failed`）。没做卡顿探针（iOS 独有）。
- uikit：`redButtonWatchdog.ts`（`RedButtonWatchdog` 注入调度器、`endActionFor`、`endWatchdogReason`）；`useCallActions` 的 `end` 与 `reject` 都武装，phase 到 idle/ended 撤；
  到点 → `callEnd`（本地收场）+ `engine.forceEnd()`；`CallProvider` 新 prop `endWatchdogMs`（默认 3000）；视图状态 idle 下 `callEnd` 忽略。日志 `[uikit] 按下红键` / `[uikit] 红按钮本地收场：没等到结束事件`。
- 用例：engine `test/forceEnd.test.ts`、`test/forceEndEngine.test.ts`、`test/connectionFire.test.ts`；uikit `test/redButtonWatchdog.test.ts`、`test/endWatchdog.test.tsx`。
  `test/engineIce.test.ts` 的 `joinRoom` 原先靠「idle 下凭空认领 call.connected / join.ok」进房，改成先 `call.incoming` 再接通、应答真的那条 join；两条候选用例先进房。

**测之前先重起 vite**：uikit 按 `dist/` 被 demo 消费，不重起还是旧的（有一轮就这么白测了）。

## 下一步

- ~~浏览器验收~~（09-15 demo-react 5179 已验，服务端 `FAULT_INJECTION=1`）：② 故障注入拒掉 bob 的 hangup 10:06:09.548 → 10:06:12.549 `强制收场` 补发被受理，`callEnd` 只抛一次；
  ③ 延迟 bob 的 `call.invite` 8 秒、其间按取消：10:09:21 本地收场（没 call_id、没发帧）→ 10:09:24.917 invite 落地 → 补发 `call.cancel`，alice 横幅只露 13ms；`请求往返慢 elapsed_ms=8003` 也记下了。
  小账：拨出中按取消那帧没有 call_id，被服务端拒成 1401，宿主多收一条 error。
  还没验：① 正常挂断路径（iOS / Android 已验，Web 走同一段 `end`，风险低）；断网后按红键（结束帧发不出去、只本地收场）。
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
