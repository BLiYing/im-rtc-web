# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：就地覆盖、不追加。历史见 `git log` 与 [current_task.archive.md](current_task.archive.md)（末节「2026-09-15 09:xx 精简前：强制收场与红键看门狗」）。
> 规范 [CONVENTIONS.md](CONVENTIONS.md) · 分期 server `docs/design/RTC_CALL_DESIGN.md` §10 ·
> 界面以设计稿 **v3.1** 为准：`../im-rtc-server/docs/design/sketches/RTC_CALL_UI_SPEC.html` / `RTC_CALL_UX_FLOWS.html`。
> ✅ 状态只写在 `../im-rtc-server/docs/CLIENT_PARITY.md`。

## 当前焦点

**2026-09-15：宿主对接 M1 → M2 → M8（`../im-rtc-server/docs/design/HOST_INTEGRATION_DESIGN.md` §3）三期都做完，未提交。`./scripts/test.sh` 全绿（14 步，engine 366 / uikit 173 / demo-react 17）。**

- **M1（engine）**：`call.invite` / `call.incoming` / `call.connected` 加 `chat_group_id`（三处）与
  `call.connected` 加 `caller` / `user_data`（`signaling/frames.call.ts`）；`call()` 签名改成
  `call(calleeIds, mediaType, options?: boolean | CallOptions)`（`CallOptions = {isGroup?, chatGroupId?,
  userData?, timeoutSec?}`，传布尔等同旧 `isGroup`）；新增 `joinCall(callId)`（状态机那半——
  `callMachine.ts` 的 `join_call` / `joinOngoingCall`、`engineMachine.ts` 的 `CALL_ACTS`、
  `frameLoop.ts` 的 rollback 表——**M1 开工前就已经在，这次只是把门面方法补上**）；`ErrorCode.inviteDenied
  = 1409`；本地校验 `chatGroupId`（>64 字节或含空白）/ `userData`（>4096 字节），与「名单里有自己」同一个
  出口（`engine.ts` 的 `rejectsBadCallOptions`，纯校验挪进新模块 `callOptions.ts` 的
  `violatesCallOptionLimits`——engine.ts 是体量红线卡得最紧的文件，能抽出去的纯函数不留在里面）。
  `CallContext` 新增 `chatGroupId` / `userData` 两个字段，
  只当 `call.connected` 没带值时的回落（`callRecv.ts` 的 `handleConnected`）。
- **M2（uikit）**：新模块 `src/invite/`（`types.ts` 的 `InviteContext` / `InviteCandidate`（扩
  `avatarUrl`/`subtitle`/`selectable`/`unselectableReason`）/ `InviteProvider` / `OnInviteRequest` /
  `CanInvite`，`inviteContext.ts` 的 `buildInviteContext`）；`CallProvider` 新 props `inviteProvider` /
  `onInviteRequest` / `canInvite` / `allowManualUidInput`（默认 `false`），经 `useCall().invite` 暴露；
  `InvitePicker.tsx` 整个重写：300ms 防抖 + 请求序号作废旧结果、滚到底翻页、加载中/失败(重试)/
  超时(10s) 三态、已在通话中不可选、`selectable:false` 置灰带 `unselectableReason`、按 `slotsLeft`
  限选；`ActiveCall.tsx` 的 `handleInvite` 做取名单优先级（`onInviteRequest` 接管 > 弹
  `InvitePicker`）；`CallHeader.tsx` 的按钮显隐叠加 `invite.canInvite(ctx)`（不叠加 chatGroupId 判断）。
  `useCall().joinCall(callId)`：`joinCallRequested` 直接把 `CallViewState.phase` 打成 `connecting`
  （复用既有的「接通中…」文案，不经来电页）；失败时 `joinCallFailed` **自己**把阶段收到 `ended`
  并把 `CallEnded` 要显示的文案换成「无法加入该通话」（`state/callView.ts` 的 `joinDeniedTextFor`）——
  不依赖真 engine 是否会紧跟着抛一条 `callEnd`，两条路径都收得住（`useCallActions.joinCall` 的注释里
  记着为什么不能用 `try/catch` 拿失败：`FrameLoop.sendFrame` 从不把服务端拒绝转成异常）。`inviteMore`
  被 1409 拒时提示「对方暂时无法被邀请」。静态 `inviteCandidates` 保持兼容（取名单优先级最低档）。
- **Demo**：`demo-react/src/fakeInviteProvider.ts`——真实 `DEMO_CONTACTS` 排前面 + 40 个假成员凑分页
  （一页 12 条），搜索词 `fail` 立即 reject、`slow` 永远不 resolve（验证 uikit 的 10 秒超时）；`App.tsx`
  把 `inviteCandidates={DEMO_CONTACTS}` 换成 `inviteProvider={fakeInviteProvider}`；`Dialer.tsx` 群呼带
  `chatGroupId: 'demo-group'`，新增「按 call_id 加入」一行（`useCall().joinCall`）。`demo/`（自画 UI）
  没碰通话 API，`tsc --noEmit -p demo` 照样过。
- 新增测试：engine `test/callOptions.test.ts`（`call()` 的 options 校验、`joinCall` 正常与被拒两条路径）+
  `test/callMachine.test.ts` 补的回落用例（`call.connected` 不带群号时回落到 `call()` 选项 / `call.incoming`
  记的那份）；uikit `test/hostIntegration.test.tsx`（14 条：`joinCall` 三条、`inviteProvider` 六条含防抖/
  分页/失败/超时、`onInviteRequest` 三条、`canInvite` 两条）；`interactions.test.tsx` 改了一条
  （`allowManualUidInput` 默认关，原「宿主没给名单：输入 uid 也能邀请」拆成两条）。

## 下一步

- **没做 / 已知限制**：
  - `joinDeniedTextFor` 不按错误码细分文案——设计稿只钦定了「无法加入该通话」一句通用话，1401/1402/
    1405/1408/1202/1409 走 `call.join` 失败都共用它。以后要分档看 `state/callView.ts` 那个函数。
  - `InvitePicker` 的 uid 输入框（`canTypeIn`）判的是 `items.length === 0`，不是过滤后 `shown.length
    === 0`——候选人全被过滤掉（比如只剩自己/发起人）时不会退化出输入框。旧代码就是这条限制，未修。
  - Provider 失败/超时只有 uikit 侧的表现；没有验证真机上宿主 provider 抛出的非 `Error` 值（字符串、
    `undefined`）会不会被 `String(err)` 弄丢原因——现在只有一条 `logger.warn`。
  - **浏览器没有手动验**：`joinCall` 双开标签页互测、`fail`/`slow` 搜索词在真实 5179 demo-react 上没有
    点过一遍，只在 jsdom 里过了。下次起 `./scripts/dev.sh start react` 顺手点一遍。
  - server 端 `call.join` 与邀请鉴权回调是另一个人同时改的，本仓没有跟着联调（协议文档已定稿，
    向量已跑绿，但没有对着真服务端发过一次真实 `call.join`）。
- **协议 / 文档侧发现的问题（需要跟服务端那位或文档作者对一下，本仓没有改它们）**：
  - `RTC_PROTOCOL.md` §4.1 `call.invite_more` / `call.join` 的错误分支表没提 1409（只在 §3.5 与 §7.1
    提过），读的人容易漏掉「宿主开了邀请鉴权回调也会在这两条帧上收到 1409」。
  - `HOST_INTEGRATION_DESIGN.md` §3.4 没写清楚 provider 超时之后、宿主的回调如果**迟到才真的 resolve**
    要怎么处理——本仓按「迟到的结果一律按 `seq` 作废，不回填」处理（同「新请求作废旧结果」一个机制），
    这条约定值得回写进设计文档，否则其余三端可能各自选了不同的处理方式。
- `CLIENT_PARITY.md` 真机验完再改（本仓不改该文件）。
- 里程碑完成后按惯例应同步 server `docs/design/RTC_CALL_DESIGN.md` §10 的状态——**本次没有改**（任务
  范围明确只改 im-rtc-web 仓），麻烦碰 server 仓的人补一下 M1/M2/M8 web 列的日期。

## 已知坑 / 限制

- **`FrameLoop.sendFrame` 从不把服务端拒绝转成异常**：`call()` / `joinCall()` / `inviteMore()` 这类
  「发一帧、等应答」的门面方法在被服务端拒绝时永远 `resolve`，不会 `reject`——失败只经由 `error` 事件
  + 随后的状态机收场（`call_failed` → `onCallEnd`）体现。**写宿主代码或测试时不要用 `try/catch` 猜失败**，
  订阅 `error` 事件或看状态机的落地状态。`useCallActions.joinCall` 与 `inviteMore` 的注释里各记了一次。
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
- 状态机 `args` 一律 snake_case（与向量、另外三端同名），转 camelCase 是 `engineBus` 的活。
- `packages/call-engine/src/` 里不能放 `*.test.ts`（会被 `tsc -b` 算进 build），测试放 `test/`。
- 换 token 是宿主的事（协议 §1.5），engine 只提供 `updateToken`；发送侧一律 `newFrameData(FIELDS)` 起手（§2.4 默认值陷阱）。
- 画质是宿主策略（`videoProfile`），改档位同步服务端 `bwe.go` 的 `bitrateHigh`。
- SDK 版本号改 `packages/call-engine/src/version.ts`（`SDK_VERSION`）+ 两个 `package.json`（五端统一 1.0.0，握手 `web/1.0.0`）。
  demo-react 设置存 localStorage（双开共用），登录态仍是 sessionStorage；它的 vitest 已进 test.sh，但**体量门禁与日志门禁都不扫 `demo-react/`**（老漏洞，未修）。

## 关联工程 / 常用命令

- 协议契约与一致性向量：`../im-rtc-server/docs/RTC_PROTOCOL.md` 与 `../im-rtc-server/docs/conformance/`，只读引用。
- 宿主对接设计：`../im-rtc-server/docs/design/HOST_INTEGRATION_DESIGN.md`（本轮 M1/M2/M8 的依据，§3）。
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
