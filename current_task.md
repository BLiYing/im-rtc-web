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

**上行 simulcast 只是「说了没做」，已修（2026-09-08）**，`./scripts/test.sh` 13 步全绿。

`publishCamera(simulcast = true)` 这一位一路传进了 `room.publish` 帧、**告诉服务端「我有三层」**，
可媒体面走的是裸 `pub.addTrack(track, stream)` —— 那只会产生一个 encoding，
整个 `packages/` 里搜不到一处 `sendEncodings` / `rid`。

后果不是「少一层可选」而是**层选择整条链路失效**：服务端只看到空 RID 的单层，
订阅者报 `l` 也只能拿到全速率的 h（`selectLayer` 的兜底），弱下行的那一方被自己收到的流压死。
真机 2026-09-08 坐实：Android 老实发三层，web 只发一层，手机侧估计值一路锁在 100kbps。

改成 `addTransceiver(track, { sendEncodings })`（**必须建 transceiver 时给出**，
协商后再 `setParameters` 加不出层）。同轮修掉 `applyVideoBitrate` 把三层码率抹平成同值的问题。


**握手被拒就一次放弃（2026-09-07）**，`./scripts/test.sh` 13 步全绿。

补的是 Android 那条五端契约（`CLIENT_PARITY.md` v1.17）。原先的放弃逻辑**只认关闭码
4401**，不认 `sys.hello` 应答里的错误码：`device_id` 不合规回的是 1004 错误帧，于是
握手 reject → 连接断 → `handleClose` 拿到一个普通关闭码 → 无限退避重连。真机上的样子是
界面写着「登录失败」，日志刷满同一条错误，真正的原因被埋在里面。

| 改动 | 为什么 |
|---|---|
| `connection.ts` 的 `handshake()` 只把 **dispatchRequest 那一段**包进 try，失败走 `abortIfHandshakeRejected` | 判据是错误码表里的 `retryable`（四端共用的一致性向量），不另立名单。「握手应答类型不对」那条**刻意留在 try 外**——那是对端实现 bug，处置另说 |
| 停手用 `reconnector.stop()` 而不是 `cancel()` | 一次失败从**两条路**走到 `schedule()`（close 事件 + `connect()` 被拒的微任务），只取消定时器的话迟到的那条会把重连排回来。注入 `cancel()` 验过：三条用例立刻红 |
| `KickedOutReason` 加 `'configRejected'` | `takenOver` 是回登录页、`authExpired` 是换票重来，都救不了 `device_id` 里的空格 |
| `ErrorCode` 常量表补 `appDisabled: 1106` | 之前只加进了 `ERROR_DEFINITIONS`，而一致性测试比的是那张表，所以没抓到——宿主根本引用不到这个码 |

**测试里踩到一个空断言**：假服务端只回错误帧、不关连接，于是没有任何东西会去排下一次
重连，「不再重连」那条断言**永远为真、注入 bug 也不红**。补上 `closeFromServer` 才载重。
两个方向都验过红（完全不放弃 → 4 条红；连 1102 也停 → 3 条红）。

## 下一步

- **浏览器复测**：九宫格这一批（三格是不是「第一行两个」、加号格真的没了、群呼选人能勾能拨）+ 上一轮的五条（通话中来电只出提示、群通话被叫也有占位格、两端关摄像头
  小窗仍在、加人真的能加进来、发起人挂断后其余人继续）+ 上一轮欠的四条
  （开摄像头失败的降级、加人被拒后占位格收回、提示 3s 自撤、小窗首帧不从左上角弹出去）。
- iOS / Android 已按同一份稿落地（见各自的 `current_task.md`），**都还没真机验**。
- Demo 还没演示的：主动换设备、桌面独立窗口（那是 desktop 仓的事）。
- 预警线上的三个文件：`signaling/connection.ts` 382、`engine.ts` 386、`state/roomMachine.ts` 347（上限 400）。
  **下一次动它们时先拆。**

## 已知坑 / 限制

- **「人先进来、轨道后到」是常态，不是异常**：格子挂载那一刻 `useRemoteTrack` 往往还是空。
  任何「挂载时顺手做一次」的 effect（层上报、尺寸、订阅）**依赖数组里都得带上 `hasVideo`**，
  否则轨道到了不会重跑——层上界为此空转过整整一版（`VideoTile` 已补）。

- **权限状态查询只用来决定要不要出说明卡，不用来判失败。** 判失败一律靠真探：Demo 的合成媒体源不走
  `getUserMedia`，浏览器说「已拒绝」而媒体层其实拿得到——信了查询就把能打的电话拦下来（本轮实测撞到）。
- **Safari 的 `getUserMedia` 必须在用户手势的调用栈里**：接听流程是「点接听 → 先探设备 → 再发 accept」，
  中间不能夹别的 `await` 网络请求。
- **语音版式与页内小窗都没有对端的 `<video>`，声音靠 `RemoteAudioSink`**——engine 只把流挂到
  `attachView` 给的元素上，没挂元素的人是没有声音的。别删那个隐藏 `<audio>`。
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
  npm run dev                                      # 自画 UI 的 Demo（:5178）
  npm run dev:react                                # 引 uikit 的 Demo（:5179）
  ```
- 浏览器实测要点：两个标签页各登一个用户并**勾上「合成音视频源」**（Browser 面板里拿不到真麦克风）。
