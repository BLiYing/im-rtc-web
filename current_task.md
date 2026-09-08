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

**握手被拒按「谁救得了」分流（2026-09-08）**，`./scripts/test.sh` 十三步全绿。

补齐 Android `629352a` 那条五端契约。原先 `abortIfHandshakeRejected` 是
「不可重试 → 一律 `configRejected`」一个桶，**不可重试 ≠ 参数不对**，
合成一类等于给宿主一条错的建议。同轮修掉两条边界，三个缺陷都在这一条路上：

| 缺陷 | 症状 | 改法 |
|---|---|---|
| 三类合成一桶 | 1101 明明换一枚票就能好，报成「去改配置」；1104 是被顶下线，该回登录页 | 1101 → `authExpired`、1104 → `takenOver`、其余 → `configRejected`。`KickedOutReason` 三个值本来就都在，只是没往那儿分 |
| local 组没挡 | `close()` 拿 `2005 invalid_state`（`retryable === false`）结掉在飞的握手，那是**宿主自己按的 logout**。只看 `retryable` 的话一次正常 logout 就报成「服务端拒了你的参数」——而静默续期正是先 logout 再换票，等于**续期把人踹回登录页** | 判据先 `isLocalError(code)` 挡掉 |
| 未知码兜底反了 | 未知码在 `RtcError` 里折成 internal（1501，而它 `retryable === true`）→ **服务端每加一个新的终局码，客户端就多一种无限重连**。1106 在四端漏过一次就是这个形状 | 折算前把帧上的 `retryable` 留进 `RtcError.unknownCodeRetryable`，只在本端不认识那个码时才有值；判据变成 `unknownCodeRetryable ?? retryable` |

**修的时候撞到一个同源问题**：「线路错误帧 → `RtcError`」有**两份实现**
（`pendingRequests.settle` 与 `connection.toRtcError`），第一版只改了后者，
而握手恰恰走前者——用例当场红。已收敛成 `errors.ts` 的 `rtcErrorFromWire()` 一份。

**顺手拆了 `connection.ts`**：判据加进去后它涨到 428 行、过了 400 红线，
按仓规矩拆而不是抬阈值——判据独立成 `signaling/handshakeGiveUp.ts` 的纯函数，
`connection.ts` 回到 375 行。纯函数也让那两条在假服务端里造不出来的分支
（local 组里可重试的码、未知码而帧上没带 `retryable`）能被直接钉住。

**新增用例：`connection.test.ts` 4 组 + `handshakeGiveUp.test.ts` 5 条，注入旧逻辑验过载重**——
换回「不可重试 → configRejected」后四条立刻红（1101、1104、未知终局码、logout 误判）。

**没做**：纯信令逻辑，**没上浏览器**；iOS 侧同一条契约已在 `im-rtc-ios` 落地（同日）。
`CLIENT_PARITY.md` 第 180 行那格与第 124 行的历史说明目前仍不准（写着「只有 Android 有」），
两端都齐了，可以一次改到位。

---

**网络一直不回来时通话再也退不出去，已修（2026-09-08）**，`./scripts/test.sh` 十三步全绿。
**未真机复验。**

本地放弃的**唯一**入口是「重连上了但 `resumed=false`」时的 `synthesizeNetworkEnd`，
它要求先连回来；网络不回来那一刻永远不会到，界面就永远停在「正在重连」，
而且**连挂断都点不动**（挂断只产出一帧发不出去的 `call.hangup`，本地状态按 §4.2 铁律 1
一动不动）。真机是在 iOS 上撞到的，四端同形；iOS / Android 已先修，本仓跟上。

`ResumeDeadline`（单独一个模块，理由与 `Reconnector` 相同：体量红线 + 独立测试面）
起一条倒计时，断开超过**上界**就抛 `onSessionUnrecoverable`，
状态机走与 `resumed=false` 完全相同的那段。协议 §1.4 有对应条款。

**上界 = `3×ping + 30s + 5s` 余量（默认 80 秒），不是恢复窗口那 30 秒**：
服务端的 30 秒是从**它自己察觉**算起，而它要连续 3 个心跳周期收不到东西才察觉（§1.3）。
**取短了会杀掉一通还能恢复的电话** —— 真机实测断开 14 秒后重连成功、通话照常继续。

顺带：`engine.ts` 里那段关于「握手结果一律从这里进状态机」的 8 行注释
与 `EngineConnectionHandlers.onConnected` 上的文档几乎逐字重复，去重后
`engine.ts` 从顶格的 400 行降到 396 —— **这不等于那个拆分做完了**，只是腾出了余量。

**上行 simulcast 只是「说了没做」，已修（2026-09-08）**，`./scripts/test.sh` 13 步全绿。

## 下一步

- **浏览器复测**：九宫格这一批（三格是不是「第一行两个」、加号格真的没了、群呼选人能勾能拨）+ 上一轮的五条（通话中来电只出提示、群通话被叫也有占位格、两端关摄像头
  小窗仍在、加人真的能加进来、发起人挂断后其余人继续）+ 上一轮欠的四条
  （开摄像头失败的降级、加人被拒后占位格收回、提示 3s 自撤、小窗首帧不从左上角弹出去）。
- iOS / Android 已按同一份稿落地（见各自的 `current_task.md`），**都还没真机验**。
- Demo 还没演示的：主动换设备、桌面独立窗口（那是 desktop 仓的事）。
- 预警线上的四个文件：`engine.ts` **400（已顶到上限）**、`signaling/connection.ts` 375、
  `media/webrtcAdapter.ts` 359、`state/roomMachine.ts` 354（上限 400）。
  **下一次动它们时先拆**——`engine.ts` 再加一行就是 FAIL。

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
