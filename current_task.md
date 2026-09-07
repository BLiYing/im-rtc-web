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

**会话恢复之后重新协商上行（2026-09-07）**，`./scripts/test.sh` 全绿。

与 iOS 同一条：`restart_pub_ice` 只在房间 `joined` 时被接受，而网一断信令也断、房间变
`reconnecting`，PC 却要 30 秒后才判 `failed`——那时动作被拒且**不进 `BUFFERABLE_OPS`**，
永远丢失。iOS 真机 2026-09-07 抓到了实证（`动作被状态机本地拒绝 op=restart_pub_ice
room_state=reconnecting`），Web 这条路一模一样。

改法：`engine.ts` 的 `onConnected` 里等 `sys.hello.ok` 落地之后，`resumed===true` →
`media.restartPubICE()` + dispatch `restart_pub_ice`（协议 §1.4 早有规定，只是没实现）。
测试脚手架顺带改了：`setup()` 现在留住**每一条**连接（`latest()`），重连的断言要看新那条。

**没做 / 已知限制**：本轮**没有任何真机复验**——ICE 那条尤其要真的拔网线才验得了。
Android「无法挂断」的**根因未定**（Android 不上报日志到 logsink，只有 logcat），
只做了「红按钮永不静默」的兜底；服务端补发一落地，那个僵尸态本身就不该再出现了。

## 上一轮

**上行 ICE 断了自己重连 + 补上「轨道后到要重报层上界」那个洞（2026-09-06 夜）**，
`./scripts/test.sh` 13 步全绿（engine 186 + uikit 93）。

| 改动 | 为什么 |
|---|---|
| **`pub` PC failed → 置重启位 + 重发 `room.offer{pc:pub}`**（`mediaPlane.onPcState` + `webrtcAdapter.restartPubICE` + 状态机新 act `restart_pub_ice`） | 那条 PC 的 offerer 是本端，**只能自己救**；`sub` 那条由服务端救（协议 §3.3 已补规则）。不救的后果：切网 / 休眠 / 标签页被节流久了，人就**永久掉出这通通话**，对端格子从此是一块黑，而界面上一切正常、谁也不挂断。`restart_pub_ice` **不进 `BUFFERABLE_OPS`**：那是「此刻网断了」的即时反应，重放一个过期的重启只会白折腾一次协商 |
| **`VideoTile` 的层上界 effect 把 `hasVideo` 加进依赖** | `setRemoteLayer` 按 uid 找他当前的视频轨道再发帧，而**人先进来、轨道后到是常态**：`userEnter` 那一跑什么都没发出去，而依赖没变就再也不会重跑——服务端一直按默认的 `m` 下发，九宫格里八个小格子每格都收半高清，症状只是「画面卡」，一条报错都没有。**不拿它当开关**（不是 `if (!hasVideo) return`）：轨道没到时报一次是无害空转，而「没画面就不报」会在对端只是临时关了摄像头时丢掉层上界 |

两条都先回滚实现看它红过。**没做**：浏览器实测。

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
