# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：只记当前状态，**就地覆盖、不追加**。历史见 `git log`。
> 工程规范见 [CONVENTIONS.md](CONVENTIONS.md)；方案与分期见 `im-rtc-server` 的
> `docs/design/RTC_CALL_DESIGN.md` §10；界面以草图 §06 为准。

## 当前焦点

**P2 第一刀已落地（2026-09-03）：engine 的协议层跑通了四仓共用的一致性向量。**

服务端的 P0（协议契约）与 P1（SFU 最小可用）都已完成，本仓可以正式开工。

已落地：
- **npm workspaces 骨架** + `tsconfig` 严格档（`strict` / `noUncheckedIndexedAccess` /
  `exactOptionalPropertyTypes` / `noImplicitOverride` / `noFallthroughCasesInSwitch`）。
- **`@im-rtc/call-engine` 的协议层**：信封编解码、§2.4 编码硬规则、40 个帧的字段声明、
  45 个错误码、reason 枚举与群主导优先级。
- **`scripts/test.sh` 五步全绿**：依赖 → 体量门禁 → 向量可达 → `tsc -b` → `vitest run`（79 个用例）。

两个有意的设计取舍：
- **帧用声明式定义**（`signaling/fieldSpec.ts`），一处声明同时产出运行时校验与 TS 类型。
  服务端是逐帧写结构体，这里用条件类型推——**两处写会漂，一处写不会**。
- **向量只读引用 `../im-rtc-server/docs/conformance/`，绝不拷贝进本仓**。
  找不到时 `test.sh` **报错而不是跳过**：被静默跳过的一致性测试比没有测试更糟。

**第一刀就抓到一个真漂移**：Go 按字面量判浮点（见到 `e` 就拒），JS 只能按值判，
于是 `1e3`（整数 1000）TS 发得出去、Go 收不下来。两端已统一按值判定，向量加了四条守着。

## 下一步

**P2 第二刀 —— 让 engine 真的连上服务端**

1. `signaling/connection.ts`：WS 客户端 + `sys.hello` 握手 + 心跳 + **请求按 req_id 配对**
   （pub 侧的 `room.offer` 由 `room.answer` 应答，只看类型对不上号）+ 退避重连
   （`1s,2s,4s,8s,15s,30s`，±20% 抖动，三端同一份）。
2. `state/roomMachine.ts`：房间与 Track 状态机，跑 `room_fsm.json` 向量。
3. `media/WebRTCAdapter.ts`：**两条 PeerConnection**，各有固定 offerer（pub=本端、sub=服务端），
   所以**不需要 perfect negotiation / rollback**。
4. 验收：本仓的 engine 连上 `im-rtc-server`（`./scripts/dev.sh`）跑通
   与 `rtc-cli -scenario media` 等价的流程——发布音频、订阅、收到 RTP。

**P2 第三刀**：uikit（来电 toast、1v1 浮窗、mini 浮窗）+ Demo 站点（登录/拨号/通话记录）。
验收：两个浏览器 1v1 语音/视频接通、双向画面、静音/关摄像头互见、Chrome 限速下不断线。

**P4**：群通话九宫格，依赖服务端 simulcast 层选择；用 `webrtc-internals` 验证层切换。

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

## 关联工程 / 常用命令

- 协议契约与一致性向量：`../im-rtc-server/docs/RTC_PROTOCOL.md` 与 `../im-rtc-server/docs/conformance/`。
  **只读引用，不得单方面加字段**；改协议 = 改四个仓 + 同步向量。
- 起服务端联调：`cd ../im-rtc-server && ./scripts/dev.sh`（控制面 :8787，媒体面 UDP 7881）。
  `./scripts/e2e.sh media` 可以确认服务端这边是通的，再来排查本仓。
- 常用命令：
  ```bash
  ./scripts/install-hooks.sh                       # 新 clone 跑一次，装 pre-commit 体量门禁
  ./scripts/test.sh                                # 唯一测试入口：依赖 → 体量 → 向量可达 → tsc -b → vitest
  npx vitest run --root packages/call-engine       # 只跑测试
  RTC_CONFORMANCE_DIR=/path/to/conformance ./scripts/test.sh   # 向量不在同级目录时
  ```
