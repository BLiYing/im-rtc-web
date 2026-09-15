# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：就地覆盖、不追加。历史见 `git log` 与 [current_task.archive.md](current_task.archive.md)（末节「2026-09-15 API 命名对齐前：宿主对接 M1→M2→M8 + 1409 缺口修复」）。
> 规范 [CONVENTIONS.md](CONVENTIONS.md) · 分期 server `docs/design/RTC_CALL_DESIGN.md` §10 ·
> 界面以设计稿 **v3.1** 为准：`../im-rtc-server/docs/design/sketches/RTC_CALL_UI_SPEC.html` / `RTC_CALL_UX_FLOWS.html`。
> ✅ 状态只写在 `../im-rtc-server/docs/CLIENT_PARITY.md`。

## 当前焦点

**2026-09-15：四端 API 命名核对——本仓只改 im-rtc-web（协议文档 / CLIENT_PARITY / 另外三端由别的会话并行改）。
直接在 main 上改，未 commit / push。`./scripts/test.sh` 全绿（14 步；engine 385 / uikit 180 / demo-react 17）。**

- **`callCancelled` 事件载荷 `{by}` → `{uid}`**：只改公开事件表这一层——线路字段与一致性向量
  （`call_fsm.json`）钉的仍是 `by`，`callRecv.ts` 内部回调参数不能跟着改。翻译点在
  `engineBus.ts` 的 `emitMachine`（新增一条 `callCancelled` 专属的 `by→uid` 改名，其余事件走
  照常的 snake→camel）。下游改了 `events.ts` 的类型与 `subscribeEngine.ts` 的 `e.by`→`e.uid`。
- **新增 `CallEngine.destroy(): void`**：终态销毁 = `logout()` + `EngineBus.clear()`（新增）。
  **可重复调用**（幂等，不重复 logout）。之后再调「发起动作」的方法统一**抛 `2005 invalid_state`**
  （不是静默空操作——事件订阅已清空，静默的话宿主的 `hangup()` 之类调用会石沉大海，没有任何
  信号说明原因）；新增私有 `act()`（`call/joinCall/accept/reject/cancel/hangup/inviteMore/joinRoom/
  leaveRoom` 共用的 dispatch 外壳，顺带把销毁检查收在一处）与 `mediaApi()` 里的检查（覆盖
  `probeMicrophone/probeCamera/publishMicrophone/publishCamera/setMuted/setRemoteLayer` 及新增的
  四个 open/close 方法）；`login()` / `startLocalPreview()` 单独各挂一行检查。**例外**：`logout()` /
  `forceEnd()` / `on()` / `uid` / `state` / 读或清理类方法（`attachView` 传 `null`、`localTrack`、
  `stopLocalPreview`、`updateToken`）**不受影响**，销毁后调用仍安全——它们本来就该在任意时刻可
  无脑调用（尤其 `forceEnd()`，红键看门狗与 `logout()` 都靠它"绝不抛"这条契约）。
- **新增按类型的媒体开关**（`openMicrophone` / `closeMicrophone` / `openCamera` / `closeCamera`，
  与腾讯 TUICallEngine 同名）：open = 该类型还没发布就发布（摄像头复用预览，走 `publishCamera`
  现有逻辑），已发布就 `setMuted(cid, false)`；close = 对已发布的那条 `setMuted(cid, true)`
  （不 unpublish），没发布过是空操作。**「发没发布过」问的是媒体适配器自己的账**
  （`MediaAdapter.publishedMicrophoneCid()` / `publishedCameraCid()`，新增到接口，`WebRTCAdapter`
  实现——麦克风新增 `micCid` 字段跟 `acquire()` 一起记账，摄像头复用已有的 `preview`/
  `cameraPublished`），**不在门面 `engine.ts` 另开一份影子记账**：协调会话中途指出 iOS 在等价
  实现上踩过这个坑——门面自己记账的话，宿主先直接调 `publishMicrophone()` 发布过、再调
  `openMicrophone()` 会被误判成"没发布"而重复发布（pub PC 上多挂一条 sender）。`micCid` 的清账
  跟着 `WebRTCAdapter.close()` 走（`bridge.reset()`/`bridge.close()` 已经在通话结束/离房/logout
  时调它，不需要另外接线）。`publishMicrophone`/`publishCamera`/`setMuted(cid)` 保留作高级接口；
  uikit 内部未改用新方法（未扩大改动范围，符合任务边界）。
- **uikit 改名对齐 iOS/Android**：`CallProvider` 的 prop `inviteProvider` → `inviteMemberProvider`，
  `onInviteRequest` → `presentInvitePicker`；类型 `InviteProvider` → `InviteMemberProvider`，
  `OnInviteRequest` → `PresentInvitePicker`（`invite/types.ts` + `index.ts` 导出同步）。
  `InviteConfig`（`CallProvider.tsx` 内部 context 形状）的字段名 `provider`/`onRequest` **未改**
  ——那是内部实现细节，不是公开 prop。`ProfileProvider` 按规格**不改名**。Demo 侧
  `fakeInviteProvider.ts` → `fakeInviteMemberProvider.ts`（连带改了 `App.tsx` 的 import 与
  prop 名）——这处改名不在规格明文要求里，是 sed 全局替换 `InviteProvider`→`InviteMemberProvider`
  时把文件内的同名标识符一起带过去了，顺手把文件也重命名以保持一致，未额外核实是否有隐藏用户
  依赖这个内部命名（Demo 站点范围内应该没有）。
  **不留兼容别名**：宿主暂无人用这些 API，四个改名点全仓找不到旧名残留。
- **`CallEndReason` / `CallEndReasonValue`**：确认已经从 `@im-rtc/call-engine` 包入口
  （`src/index.ts`）导出，不用补。
- 新增测试：engine `test/mediaToggle.test.ts`（13 条，含"先 publishMicrophone/publishCamera
  再 open*"两条专门钉住"不能另开影子账"的回归用例）、`test/publishedCid.test.ts`（3 条，
  `WebRTCAdapter.publishedMicrophoneCid/publishedCameraCid` 的直接单测）、`test/engineBus.test.ts`
  （3 条，`callCancelled` 字段翻译 + `clear()`）；四个既有的 `MediaAdapter` 测试假实现
  （`test/nullMedia.ts` 改成真状态、`engineEvents.test.ts`/`updateToken.test.ts`/`engineIce.test.ts`
  的本地假类）补了新接口方法的桩，否则类型上不再满足 `MediaAdapter`（这几个测试文件不在
  `tsc -b` 的 `include` 里，不补也不会被门禁挡住，但会是隐藏的类型错误，顺手修了）。

## 下一步

- **没做 / 已知限制**：
  - `demo-react/src/fakeInviteMemberProvider.ts` 的改名是 sed 连带出来的，不是规格明文要求；
    功能未变，但如果协调会话认为 Demo 内部命名不该跟着动，可以单独 revert 这一个文件名。
  - `engine.ts`（582 行）与 `media/webrtcAdapter.ts`（529 行）体量门禁给了 WARN（阈值 480，
    硬顶 600）——都还没超标，但这次分别加了 ~100 行和 ~20 行，下次再往这两个文件加东西前
    应该先看一眼要不要拆，别等触顶才拆。
  - `destroy()` 之后哪些方法"抛 2005"、哪些"始终安全"是我按本仓既有风格自己权衡的（规格给的
    是"选一种，写进注释"），没有和 iOS/Android 的等价实现逐条对表——如果协调会话已经定了
    另外三端的选择，这条可能要跟着改成一致的策略。
  - open/close 媒体开关目前只在 `call-engine` 层加了测试；uikit 按规格没有改用新方法，所以
    uikit 侧没有新增覆盖这四个方法的测试（符合"避免扩大改动"的要求，但也意味着 uikit 集成路径
    上这四个方法目前只有 engine 层的保证）。
  - 浏览器没有手动验证：全部通过 `./scripts/test.sh`（jsdom + node）过的，没有起 `dev.sh` 在真实
    浏览器里点一遍 `openMicrophone`/`openCamera` 或验证销毁后的 UI 表现。
- 本仓不改 `../im-rtc-server` 的 `/guide` 文档、`CLIENT_PARITY.md`、`RTC_PROTOCOL.md`——按任务边界
  留给主会话处理；协议字段（`callCancelled` 的线路字段名）本身没有变化，只是 SDK 公开事件层的
  命名，理论上不需要协议文档跟着改，但如果协议文档里也写了 `EngineEvents` 层的示例代码，可能要
  一并核对。

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
