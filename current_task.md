# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：就地覆盖、不追加。历史见 `git log` 与 [current_task.archive.md](current_task.archive.md)（新的在上，顶节「2026-09-15 深夜（选人页优化前）：四端 API 命名对齐」）。
> 规范 [CONVENTIONS.md](CONVENTIONS.md) · 分期 server `docs/design/RTC_CALL_DESIGN.md` §10 ·
> 界面以设计稿 **v3.1** 为准：`../im-rtc-server/docs/design/sketches/RTC_CALL_UI_SPEC.html` / `RTC_CALL_UX_FLOWS.html`。
> ✅ 状态只写在 `../im-rtc-server/docs/CLIENT_PARITY.md`。

## 当前焦点

**2026-09-16（续）：离场的发起人可以被重新邀请（未提交）。** 服务端去掉了 `invite_more` 对发起人的 `bad_params`（见 server current_task）。本仓：
- `InvitePicker.tsx` 去掉「暂时无法邀请」分支与手输 uid 时对发起人的排除，离场的人（含发起人）照常可选。
- `callView.ts` 的 `callReceived` 加可选 `selfUid`（`subscribeEngine.ts` 传 `engine.uid`）：发起人就是自己时不给自己摆格子。
  来电页显示 `participants[0]`，被重新邀请的发起人看到的是通话里某个被叫的名字。`engine.ts` 的 `inviteMore` 注释跟改。
- 测试：`interactions.test.tsx` 改为断言离场的发起人可选并能邀请；`callView.test.ts` 新增「caller 就是自己不摆格子」。
  只跑了 `tsc -b`、demo-react 类型检查与 `callView` / `interactions` / `hostIntegration` 三个文件（68 条过），`test.sh` 全量没跑。

- **协议新增 `call.incoming.inviter`**（未提交，四端同改）：「谁把你拉进来的」，首次邀请就是 `caller`，群通话里被别人加进来时是那个人；旧服务端不带就回落 `caller`（engine 兜好，宿主不用判空）。
  `events.ts` 的 `callReceived` 加 `inviter`、`callRecv.ts` 解析并回落；`CallViewState.inviterUid`（`viewTypes.ts` / `callView.ts` / `subscribeEngine.ts`）；来电横幅 `IncomingCall.tsx` 与来电页 `ActiveCall.tsx` 显示它，九宫格与 `callerUid` 仍用 caller。
  新增 engine `callMachine.test.ts` 两条（带 inviter / 回落）、uikit `callView.test.ts` 两条；server 仓的 `call_fsm.json` 另加了两条向量用例，本仓 `callMachine.test.ts` 自动跑到。
  跑了 `tsc -b`、两个 Demo 的类型检查（自画 UI + 引 uikit）、engine `callMachine`（32 条）与 uikit 5 个文件（115 条）。

**同日已提交 `9f7c399`**：选人页列出全部成员（在通话里统一置灰「已在通话中」）、搜索框「放大镜 + 输入框」一行（`iconShapes.tsx` 的 `magnifyingglass`，Android 同一份路径）。

## 下一步

1. 用户自测（服务端先重启）：发起人挂断后，被叫在选人页能选到他并邀请；他那边来电页不出现自己的格子。自测过了跑 `./scripts/test.sh` 再提交。
2. API 命名对齐遗留：`engine.ts`（582 行）与 `media/webrtcAdapter.ts`（529 行）体量 WARN，再往里加东西前先拆；
   `destroy()` 之后哪些方法抛 2005 没和 iOS / Android 逐条对表；`openMicrophone` / `openCamera` 等四个开关只有 engine 层单测、没在真浏览器点过。

## 已知坑 / 限制

- **`callCancelled` 的公开事件字段是 `uid`，但线路帧 / 状态机内部回调参数仍是 `by`**（一致性向量
  钉死，四端共用）：新加 callMachine 相关代码或读 `call_fsm.json` 时**不要**假设两边字段名一致，
  翻译只发生在 `engineBus.ts` 的 `emitMachine` 里那一条特例分支。
- **`destroy()` 之后各方法的行为不是完全统一的一刀切**：多数方法抛 `2005`，但 `logout()` /
  `forceEnd()` / `on()` / 读或清理类方法始终安全——写新的公开方法时想清楚它属于哪一类，别默认
  抄别的方法的 `assertNotDestroyed()` 用法。
- **"发布过没有"必须问 `MediaAdapter`，不能在 `engine.ts` 自己记账**：`WebRTCAdapter` 的
  `publishedMicrophoneCid()`/`publishedCameraCid()` 是唯一真相源，`micCid` 字段与 `acquire()`
  同步维护、`close()` 里清零——任何新增的"按类型查询发布状态"的需求都应该复用这两个方法，
  而不是新开一份字段。
- **`FrameLoop.sendFrame` 从不把服务端拒绝转成异常**：`call()` / `joinCall()` / `inviteMore()` 这类
  「发一帧、等应答」的门面方法在被服务端拒绝时永远 `resolve`，不会 `reject`——失败只经由 `error` 事件
  + 随后的状态机收场（`call_failed` → `onCallEnd`）体现。**写宿主代码或测试时不要用 `try/catch` 猜失败**，
  订阅 `error` 事件或看状态机的落地状态。
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
- **jsdom 下用 `vi.useFakeTimers()` 时，纯 `await Promise.resolve()`（哪怕连做几次）不会让 `setTimeout(fn, 0)` 落地**，得显式 `vi.advanceTimersByTimeAsync(...)`；**真实定时器**下则要用
  `await new Promise((r) => setTimeout(r, 0))` 这种真的让出一次宏任务的写法，光 `act(async () => { await Promise.resolve(); })` 在系统负载高时不稳定（`hostIntegration.test.tsx` 的分页用例踩过一次）。
- `getUserMedia` 只在 localhost / HTTPS 可用，公网联调必须 HTTPS。
- 便利事件只在 1v1 抛，群通话只抛 `onUser*`；加人失败靠 `error` 事件的 1202 / 1407 / 1409。
- effect 依赖看内容签名不看 length（`settledUids`）；回调型 prop 走 `useRef`。
- 状态机 `args` 一律 snake_case（与向量、另外三端同名），转 camelCase 是 `engineBus` 的活（但见上面
  `callCancelled` 那条例外）。
- `packages/call-engine/src/` 里不能放 `*.test.ts`（会被 `tsc -b` 算进 build），测试放 `test/`。
  **`test/` 目录本身不在任何 `tsconfig` 的 `include` 里**，`tsc -b` 不会类型检查测试代码——
  写测试假实现（`implements MediaAdapter` 之类）时接口改了要自己记得同步，门禁不会提醒你。
- 换 token 是宿主的事（协议 §1.5），engine 只提供 `updateToken`；发送侧一律 `newFrameData(FIELDS)` 起手（§2.4 默认值陷阱）。
- 画质是宿主策略（`videoProfile`），改档位同步服务端 `bwe.go` 的 `bitrateHigh`。
- SDK 版本号改 `packages/call-engine/src/version.ts`（`SDK_VERSION`）+ 两个 `package.json`（五端统一 1.0.0，握手 `web/1.0.0`）。
  demo-react 设置存 localStorage（双开共用），登录态仍是 sessionStorage；它的 vitest 已进 test.sh，但**体量门禁与日志门禁都不扫 `demo-react/`**（老漏洞，未修）。

## 关联工程 / 常用命令

- 协议契约与一致性向量：`../im-rtc-server/docs/RTC_PROTOCOL.md` 与 `../im-rtc-server/docs/conformance/`，只读引用。
- 宿主对接设计：`../im-rtc-server/docs/design/HOST_INTEGRATION_DESIGN.md`（M1/M2/M8 的依据，§3）。
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
