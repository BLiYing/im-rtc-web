# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：只记当前状态，**就地覆盖、不追加**。历史见 `git log`。
> 工程规范见 [CONVENTIONS.md](CONVENTIONS.md)；方案与分期见 `im-rtc-server` 的
> `docs/design/RTC_CALL_DESIGN.md` §10；界面以草图 §06 为准。

## 当前焦点

**P2 全部落地（2026-09-03）：engine + uikit + 两个 Demo 站点，浏览器三方实测通过。**

| 包 | 内容 | 怎么验的 |
|---|---|---|
| `@im-rtc/call-engine` | 协议层、WS 客户端、通话/房间/总状态机、WebRTC 适配器 | 157 个用例，含 50 条四仓共用向量 |
| `@im-rtc/call-uikit-react` | 来电浮层 / 1v1 / 九宫格 / 小窗 / 控制条 | 31 个用例（纯逻辑 + jsdom） |
| `demo`（:5178） | **只引 engine 自画 UI** 的示范 | 浏览器双开 |
| `demo-react`（:5179） | **引 uikit** 的示范：只写登录/拨号/记录/事件流 | 浏览器三开 |

**浏览器实测（三个标签页 + 自建 SFU，非模拟）**：
1v1 视频接通、双向画面、关摄像头对端立刻变头像、小窗收起展开、
挂断后两端同时出现通话记录；三人会议 2×2 九宫格、三路画面都是活的、发言高亮跟着走。

**这一轮 uikit 抓到四个真 bug**（都不报错、只表现为界面不动）：
1. **服务端来的 ICE 候选一直被丢掉**——trickle 只做了一半。之所以能撑到现在，
   是因为 Pion 的 SDP 里常常碰巧已经带着主机候选；进房即订阅时协商发生得早，
   SDP 里一个候选都没有，下行 PC 永远停在 `new`。三方会议必现。
2. **通话结束后房间没回 idle**——之后每一帧都发向一个已销毁的房间。
3. **协商飞行期间来的订阅被丢**（服务端侧，已在 im-rtc-server 修）。
4. **发布时机只认「阶段正好是 connecting」**——而 React 会把同一批事件合并成一次提交，
   connecting 可能一帧都不停留。

## 下一步

**P3 —— iOS**（`../im-rtc-ios`，一行未写）。四仓里只剩它没开工。
**注意：不启模拟器验证**，只能靠单测 + 一致性向量兜底。

**本仓剩下的**
- `packages/call-engine/src/engine.ts`（372 行）与 `signaling/connection.ts`（347 行）
  都过了 320 行的预警线，上限 400。**下一次动它们时先拆**。
- 弱网表现没测过（Chrome 限速对 WebRTC 的 UDP 无效，得靠服务端的 `scripts/weaknet.sh`）。
- Safari 没测过（simulcast 与 H.264 行为与 Chrome 不同）。
- uikit 还没做：双击放大某一格（`focusedLayer` 已备好但没接界面）、屏幕共享（MVP 不做）。

## 已知坑 / 限制

- **发送侧的默认值陷阱（三端都会踩，已写进协议 §2.4）**：「省略即取默认值」只对**真的省略**
  成立。`JSON.stringify` 会把显式的 `false`/`0` 编码出去——直接写 `{room_id:'r-1'}` 少了
  `auto_subscribe`，写 `auto_subscribe:false` 又把默认的 `true` 覆盖掉，**两种写法都会让人
  进了房收不到任何流**。发送侧一律用 `newFrameData(FIELDS)` 起手再改字段。
- **协议里三处与旧草案不同**：下行 `timeout` → `call.no_answer`；草图 §09 的 `room_ready` →
  `call.connected`；**Engine 状态机没有 `ended` 状态**（ended 是事件，草图里停 1.5s 的
  方框是 uikit 的展示状态）。
- **便利事件只在 1v1 抛**（`onCallCancelled/Rejected/Busy/NoAnswer`）；群通话只抛 `onUser*`，
  否则违反「便利事件后必定跟 onCallEnd」。
- **`getUserMedia` 只在 localhost / HTTPS 可用**。Demo 页面底部要写明；公网联调必须 HTTPS。
- **Safari 与 Chrome 的 simulcast / H.264 行为不同**：按实测处理并写进 `docs/`，不要猜。
- **时序类行为别在浏览器里靠肉眼判断**：面板隐藏时 `document.hidden=true`、rAF 冻结、
  程序化 `scrollTop` 不派发 scroll 事件——分不清是真 bug 还是探针死了。
  姊妹项目 im-web 为此空跑过一整轮。**一律写 jsdom 测试。**
- **effect 依赖的两个经典坑**（姊妹项目上的真实 bug）：
  ① 回调型 prop 每次渲染都是新函数，列进 deps 会无限重跑 → 走 `useRef`；
  ② 定长窗口的 `length` 恒定，靠它判断"集合变了"永远不触发 → 用内容签名。
- **刷新丢失进行中状态**：MediaStream 不能跨刷新持久化；通话中刷新即掉线，
  UI 要正确表现（重连而非假装还在）。
- **Demo 不会自动换 token**：服务端重启后 HS256 密钥变了，旧页面会带着过期 token
  一直重连（服务端日志里刷 `token_invalid`）。协议里 4401 就是「换个 token 再来」，
  **换 token 是宿主的事**，engine 不该自己去要——但 Demo 该演示这一步，暂未做。
- **发送侧带宽估计会把「码率低」误判成「链路窄」**（服务端侧已加拥塞证据闸）。
  本机回环上曾把所有人压到 l 层，原因只是合成视频源码率本来就低。

## 关联工程 / 常用命令

- 协议契约与一致性向量：`../im-rtc-server/docs/RTC_PROTOCOL.md` 与 `../im-rtc-server/docs/conformance/`。
  **只读引用，不得单方面加字段**；改协议 = 改四个仓 + 同步向量。
- 起服务端联调：`cd ../im-rtc-server && ./scripts/dev.sh`（控制面 :8787，媒体面 UDP 7881）。
  `./scripts/e2e.sh media` 可以确认服务端这边是通的，再来排查本仓。
- 常用命令：
  ```bash
  ./scripts/install-hooks.sh                       # 新 clone 跑一次，装 pre-commit 体量门禁
  ./scripts/test.sh                                # 唯一测试入口：依赖 → 体量 → 向量可达 → tsc -b → vitest
  npx vitest run --root packages/call-engine       # 只跑 engine 测试
  npx vitest run --root packages/call-uikit-react  # 只跑 uikit 测试（jsdom）
  npm run dev                                      # 自画 UI 的 Demo（:5178）
  npm run dev:react                                # 引 uikit 的 Demo（:5179）
  RTC_CONFORMANCE_DIR=/path/to/conformance ./scripts/test.sh   # 向量不在同级目录时
  ```
