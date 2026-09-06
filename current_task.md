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

**后台标签页断了就回不来（2026-09-06 傍晚）**，`./scripts/test.sh` 13 步全绿。

上一轮三端联调时记了一条「疑点，没追」：一个后台标签页出现 `连接已断开（1000），不会自动回`，
必须手动刷新。**不是浏览器节流的锅**，是本仓的重连策略**按关闭码判「是不是我们自己要走」**：

```ts
// 旧：shouldReconnect(1000) === false
// 而 connection.ts 里本来就有一句 this.state !== 'closed'——close() 会先把 state 置成 closed，
// logout 早就被它挡住了。再按码挡一次，挡掉的只剩「别人发过来的 1000」。
```

浏览器掐掉后台标签页的连接、代理 / 系统休眠断链，用的都是 1000；而**服务端从不主动发 1000**
（重启走 1001 goingAway，被踢 4403，协议错 4400）。所以收到的 1000 一定不是「对面让我别回来了」。
已把 1000 从 `shouldReconnect` 的黑名单里去掉；「主动 close 不重连」那条用例仍在，守着 logout 这一侧。
用例先只回滚实现看它红过。

**九宫格三端拉齐（2026-09-06）**，`./scripts/test.sh` 13 步全绿（uikit 92 个用例 + engine 184 个）。
起因是用户在三端并排看九宫格，报了五条；根因分析在会话里，落点分给了四个仓（本仓这一份见下）。

| 改动 | 为什么 |
|---|---|
| **撤掉网格里的加号格**（`GridStage`） | 加人入口只留标题栏右上角那一颗。同一个动作两个入口，而且加号格**占掉一个格位**——三个人的通话看起来像四个人，行列跟着多排一格。设计稿 `RTC_CALL_UI_SPEC` 差异 8 与 `UX_FLOWS §05` 已同步改（v3.3） |
| **3~4 格在竖屏容器恒为两列**（`gridDimensions`） | 原判据「正方形格子最大」的翻转压在手机常见比例上（3 格 ≈0.662、4 格 ≈0.495），iPhone 15 Pro 算 0.682、16 Pro Max 算 0.648——**同一通电话换台设备就是另一种版式**。这条是产品决定不是尺寸最优解，所以写成一句明规则；横屏不受约束 |
| **远端格子截到 8**（`MAX_REMOTE_TILES`） | **本端恒占一格**。原先按 9 截远端，会议房（服务端不设上限）进到第 10 个人时 CSS grid 会隐式多开一行、溢出居中块，而 iOS 是悄悄丢掉、Android 越过 `rowCount`——同一个房间三端三种样子 |
| **Demo 群呼改多选**（`Dialer` + 新的 `contacts.ts`） | `CLIENT_PARITY`「群呼选人」这一行本仓一直是 🟡：只有一个逗号分隔的输入框。手打有两个看不出的坑——把自己写进去服务端以 `1004` 拒掉**整通**电话；名字打错就是个永远接不起来的占位格。名单也从 5 人补到 9 人（与 iOS / Android 同一份），**5 个人根本凑不出九宫格** |

**没做**：浏览器实测。以上只有 `tsc -b` + vitest 绿，选人页与三格版式都还没在浏览器里看过一眼。

**上一轮（2026-09-06 早）：按三端真机联调日志修根因**，`./scripts/test.sh` 13 步全绿，
uikit 91 个用例 + engine 184 个。

| 症状（用户报的） | 根因 | 落点 |
|---|---|---|
| 通话中第三个人打进来会把当前通话拆掉 | 状态机**不看 call_id**：忙线那条 `call.ended` 的 call_id 是**新来那通**的 | `callRecv.isForAnotherCall`；新增事件 `callMissed` |
| 群通话里被叫只看到两格，主叫却是四格 | `call.incoming` 的 `callee_ids` 一直在发，只是没人往上抛 | `handleIncoming` → `callReceived.calleeIds` → `callView` 摆占位格 |
| 两端都关摄像头时小窗整个消失、再也点不到互换 | `pickLayout` 会退回语音版式 | 接通后的 1v1 视频恒为 video 版式 |
| 小窗入口两处（标题栏 + 控制条） | —— | 只留标题栏左上角那一颗，图标换成 `minimize` |
| 呼叫 / 来电页顶部与正中间写着同一句话 | —— | 那两个阶段标题栏留空 |

**交互规则（本轮定的）**：MVP 单通道——通话中收到第二通来电时服务端已判忙线、
**不会下发 `call.incoming`**，所以界面只出一条 3s 自撤的「谁来电，已自动回复忙线」，
不弹第二个窗、也没有「挂断当前并接听」（那需要多路会话）。呼叫方那侧照常「对方忙线中」。

**上一轮（2026-09-05）**：uikit 按设计稿 v3 落地——令牌、19 个内联 SVG 图标、
权限三段式、小窗四角吸附与长按拖动、A/B 互换、九宫格加人、页内小窗、顶部橙条；
`/code-review` 抓到的 7 条也都在那一轮修完并配了回归。

## 下一步

- **浏览器复测**：九宫格这一批（三格是不是「第一行两个」、加号格真的没了、群呼选人能勾能拨）+ 上一轮的五条（通话中来电只出提示、群通话被叫也有占位格、两端关摄像头
  小窗仍在、加人真的能加进来、发起人挂断后其余人继续）+ 上一轮欠的四条
  （开摄像头失败的降级、加人被拒后占位格收回、提示 3s 自撤、小窗首帧不从左上角弹出去）。
- iOS / Android 已按同一份稿落地（见各自的 `current_task.md`），**都还没真机验**。
- Demo 还没演示的：主动换设备、桌面独立窗口（那是 desktop 仓的事）。
- 预警线上的三个文件：`signaling/connection.ts` 382、`engine.ts` 386、`state/roomMachine.ts` 347（上限 400）。
  **下一次动它们时先拆。**

## 已知坑 / 限制

- **层上界可能一次都没真发出去**（2026-09-06 发现，**未修**）：`VideoTile` 那个
  `useEffect(…, [engine, uid, layer])` 在格子挂载时就调 `setRemoteLayer`，而它要按 uid 找
  **当前的**远端视频轨道才发得出帧——**人先进来、轨道后到**是常态，那一次是空转；
  之后 `layer` 没变就不会再跑，轨道自动订阅用的还是默认 `m`。
  Android 当天补了（轨道到了就重报一次），iOS 的 `reportedLayers` 是同一个洞。

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
