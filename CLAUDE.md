# im-rtc-web — 项目说明（供 Claude 读取）

## 项目简介
`im-rtc` 音视频产品的 **Web 客户端 SDK**，TypeScript。交付三样东西：

| 包 / 产物 | 是什么 | 谁用 |
|---|---|---|
| **`@im-rtc/call-engine`** | **无 UI** 核心，**框架无关**（不依赖 React）：信令、通话状态机、媒体、设备控制，能力通过**事件**暴露 | 想自己画 UI、或用 Vue/Svelte 的宿主 |
| **`@im-rtc/call-uikit-react`** | **整套通话 UI**：来电 toast、1v1 浮窗、群通话九宫格、mini 浮窗。依赖 engine | 想一天内上线通话的 React 宿主 |
| **Demo 站点** | 登录 / 拨号 / 通话记录，两种集成方式各跑一遍 | 验证「只用公开事件就能做出完整体验」 |

**边界（重要）**：本仓**不做宿主业务界面**——消息气泡、会话列表、"群里谁在通话"的横幅，
都由宿主拿 engine 事件自己实现。Demo 的「通话记录」是**示范**，不是要求宿主照抄。
详见 `im-rtc-server` 的 `docs/design/RTC_CALL_DESIGN.md` §9。

**uikit 不是特权组件**：它只消费公开事件表，没有任何私有通道。一旦某个界面需要 engine 开私有口子，
说明事件表少了一项 —— **补表，不开后门**。

## 技术栈
- 语言：**TypeScript**（`strict: true`），构建 **Vite**，测试 **Vitest**
- 媒体：**浏览器内置 WebRTC**（`RTCPeerConnection`），零媒体依赖
- 信令：`WebSocket`，JSON
- UI 包：**React 18**
- 包管理：npm workspaces（monorepo）

## 工程结构（规划，落地时按此展开）
```
im-rtc-web/
├── package.json                       # npm workspaces 根
├── packages/
│   ├── call-engine/                   # 框架无关，禁止 import react
│   │   └── src/
│   │       ├── engine.ts              # 门面：login/call/accept/hangup/joinRoom…
│   │       ├── events.ts              # 事件类型定义（对应设计文档 §7.5 回调总表）
│   │       ├── signaling/             # WS 客户端 + 帧编解码 + 重连退避
│   │       ├── state/                 # 通话与房间状态机（纯逻辑、跑一致性向量）
│   │       ├── media/                 # MediaAdapter 接口 + WebRTCAdapter
│   │       └── devices/               # 麦克风/摄像头/扬声器枚举与切换
│   └── call-uikit-react/
│       └── src/
│           ├── CallOverlay.tsx        # 挂在 App 根的通话层
│           ├── incoming/              # 来电 toast
│           ├── call/                  # 1v1 浮窗、控制栏、本地小窗
│           ├── group/                 # 九宫格、Tile
│           └── mini/                  # 右下角 mini 浮窗
├── demo/                              # Vite Demo 站点
└── scripts/                           # 门禁与测试入口
```

## 工作约定
- **每次开始主要回复前，先读 `current_task.md` 恢复上下文**，改动后更新它。
- **`current_task.md` 是「活快照」不是流水账**：固定四节，**就地覆盖、禁止追加 Status 块**。
- **工程规范见 [CONVENTIONS.md](CONVENTIONS.md)**（分层 / 体量 / TS 严格性 / React 纪律 / 日志 / 测试）。
- **协议契约在 `im-rtc-server/docs/RTC_PROTOCOL.md`，本仓只读引用**，不得单方面加字段。
  改协议 = 改五个仓 + 同步一致性向量。
- **单文件体量红线**：非测试 `.ts`/`.tsx` **> 400 行**要按职责拆分。
  硬闸：`scripts/check-file-size.sh`（pre-commit + `test.sh` 第 1 步）。新 clone 跑 `./scripts/install-hooks.sh`。
- 文档引用代码**不写行号**，写文件路径 + 符号名：`packages/call-engine/src/state/callMachine.ts` 的 `reduce()`。

## 工作流程与「完成的定义」
动手前（Read，不靠记忆）：
- 改代码前先 Read [CONVENTIONS.md](CONVENTIONS.md)；涉及协议字段再 Read `../im-rtc-server/docs/RTC_PROTOCOL.md`。
- 加/改**公开事件**前，先 Read 设计文档 §7.5 回调总表——**事件名四端同名**。

声明「完成」前必须全部满足，并在回复中**贴出 `./scripts/test.sh` 的输出**：
1. 新功能配套测试（`*.test.ts` / `*.test.tsx`），由 `vitest run` 自动纳入。
2. `./scripts/test.sh` 全绿（体量门禁 + `tsc -b` + `vitest run`）。
3. 更新 `current_task.md`；里程碑完成同步更新 server 仓设计文档 §10 的状态与日期（YYYY-MM-DD）。
4. 明确说清楚「没做什么 / 已知限制 / TODO」，不假装完成。
5. **时序类行为写 jsdom 测试，别在浏览器里靠肉眼判断**（姊妹项目 im-web 上的教训：
   浏览器面板隐藏时 `document.hidden=true`、rAF 冻结、程序化 `scrollTop` 不派发事件，
   分不清是真 bug 还是探针死了，为此空跑过一整轮）。

主动建议（不必用户开口）：
- 完成较大功能后建议跑 `/code-review` 自审。
- 触及 token / 权限 / 媒体密钥时建议跑 `/security-review`。

## 构建 / 测试
```bash
./scripts/install-hooks.sh   # 新 clone 跑一次
./scripts/test.sh            # 唯一测试入口：体量门禁 + tsc -b + vitest run
npm run dev -w demo          # 起 Demo 站点
```
> 脚本与 workspace 随 P2 落地补齐；当前仓库只有文档与体量门禁。

**浏览器约束**：`getUserMedia` 只在 **localhost 或 HTTPS** 下可用。Demo 页面底部要写明这一条。

## 关联仓库
| 仓库 | 内容 |
|---|---|
| [im-rtc-server](https://github.com/BLiYing/im-rtc-server) | 控制面 + SFU + **协议契约**（本仓只读引用） |
| [im-rtc-ios](https://github.com/BLiYing/im-rtc-ios) | Engine + Kit + Demo（Swift） |
| **im-rtc-web**（本仓） | engine + uikit + Demo（TS/React） |
| [im-rtc-desktop](https://github.com/BLiYing/im-rtc-desktop) | C++17 Engine + Qt Demo |
| [im-rtc-android](https://github.com/BLiYing/im-rtc-android) | Engine + UIKit + Demo（Kotlin） |

**首批宿主（下游）**：`../../im-web`（React + TS 的 IM Web 客户端）。

**本仓在分期里是 P2 —— 第一条端到端在这里跑通**：浏览器双开是最便宜的验证场，
SFU 与协议的坑先在这里踩完，再上 iOS 真机。
