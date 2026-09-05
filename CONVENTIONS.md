# CONVENTIONS —— im-rtc-web 工程规范（TypeScript / React）

> 本文是**本仓代码的硬约束**。`CLAUDE.md` 讲「这个项目是什么」，本文讲「代码必须长什么样」。
> 协议字段与事件命名以 `im-rtc-server/docs/RTC_PROTOCOL.md` 与设计文档 §7.5 为准，本文不重复。

## 1. 分层与包划分

```
@im-rtc/call-engine        框架无关。禁止 import react / react-dom / 任何 UI 库。
@im-rtc/call-uikit-react   UI。依赖 engine，只通过公开事件获取信息。
demo                       示例站点。依赖两者，不含 SDK 逻辑。
```

**依赖方向单向**：`demo → uikit → engine`。**engine 绝不反向依赖 uikit**。
engine 内部：`engine.ts（门面）→ signaling / state / media / devices`，
子模块通过接口解耦，不互相直接 import 具体实现。

**engine 必须能在无 DOM 的环境构造**（Node 下跑一致性向量测试）：
DOM/WebRTC 的接触点收敛在 `media/` 与 `devices/`，其余部分纯逻辑。

**新增东西放哪**：
| 新增 | 放哪 | 不要放哪 |
|---|---|---|
| 一个新事件 | `engine/src/events.ts` + 设计文档 §7.5 同步 | 临时加个回调参数 |
| 一个新信令帧 | `engine/src/signaling/frames.ts` + 状态机分支 | 在 ws.onmessage 里就地解析 |
| 一个新界面 | `uikit/src/<场景>/` 独立文件 | 往 CallOverlay.tsx 里塞 |
| 纯计算逻辑（布局、格式化） | 独立 `.ts` + 同名 `.test.ts` | 写在组件里 |

**uikit 禁止直接 `new RTCPeerConnection`**。视频通过 engine 提供的
`attachView(uid, el)` 挂载，换媒体实现时 uikit 一行不用改。

## 2. 文件体量红线

- 非测试 `.ts` / `.tsx` **> 400 行**即失败。
- 硬闸：`scripts/check-file-size.sh` —— pre-commit + `scripts/test.sh` 第 1 步。
- **超标的正确处理是拆分，不是放宽阈值**：
  - 组件膨胀 → 抽子组件 + 抽自定义 hook（`useCallControls`），**逻辑与渲染分离**。
  - 纯计算逻辑 → 抽独立 `.ts` 模块并**直接单测**（不经 React）。
  - 状态机膨胀 → 按状态族拆文件。
- 姊妹项目 im-web 的教训：`App.tsx` 长到 4891 行后拆了很久才收口到 2958。**别重蹈覆辙。**
- 函数/组件层面：**单个函数超过 ~50 行**就该拆；一个组件超过 ~120 行考虑抽子组件。

## 3. TypeScript 严格性

- `tsconfig` 必开：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、
  `noImplicitOverride`、`noFallthroughCasesInSwitch`。
- **禁止 `any`**。确需逃逸用 `unknown` + 类型收窄；`as` 断言必须紧跟注释说明为什么安全。
- **禁止 `@ts-ignore`**；确需时用 `@ts-expect-error` 并写原因（它会在问题修复后自己报错）。
- 公开 API 的类型**显式标注**，不靠推断（推断出的类型会随实现漂移，破坏使用方）。
- 网络/事件边界的数据先**运行时校验**再进类型系统；不要「声明成 T 就当它是 T」。
- 枚举用 `as const` 对象 + 联合类型，不用 TS `enum`（后者有运行时开销与互操作坑）。

## 4. 命名

- 文件：模块 `camelCase.ts`，React 组件 `PascalCase.tsx`。
- **事件名四端同名**：`onCallReceived` / `onCallBegin` / `onCallEnd` …
  `engine.on('callReceived', …)` 这种字符串键要与设计文档 §7.5 一一对应。
- 时间量带单位：`timeoutMs`、`durationSec`。
- 布尔量用 `is` / `has` / `should` 前缀。
- 禁止 `data` / `info` / `utils` / `helpers` 做模块名（无语义，最终变成垃圾桶）。

## 5. React 纪律（仅 uikit / demo）

- **函数组件 + hooks**，不用 class 组件。
- **effect 的依赖数组必须诚实**：不许为了「少跑一次」漏依赖。
  - **回调型 prop 走 `useRef`，不进 deps**（姊妹项目上因把每次渲染新建的函数列进依赖，
    导致 effect 无限重跑、CPU 空转、jsdom 测试直接挂死）。
  - **判断集合是否变化看内容签名，不看 `length`**（定长窗口的 `length` 恒定，
    靠它触发的 effect 永远不重跑——这是姊妹项目上的真实 bug）。
- 状态尽量下沉到用得到的最小组件；跨组件共享用 context，不引状态管理库。
- **不在 render 期间做副作用**（订阅、计时器、媒体操作一律进 effect 并清理）。
- 列表 key 用**稳定业务 id**（`uid` / `callId`），绝不用数组下标。
- 组件卸载时必须清理：事件订阅、`setInterval`、`AbortController`、媒体轨道。

## 6. 日志

> 机制与五仓对齐见 `../im-rtc-server/docs/mechanism/LOGGING.md`。
> 本节只列硬约束；**每一条都有闸门**（`scripts/check-logging.sh`，进 `test.sh`）。

- **统一走 engine 的日志入口**（`logger.ts`，可注入 sink），uikit 与 demo 共用。
- **禁止 `console.log` / `console.warn` / `console.error` 直接出现在业务代码**。
  姊妹项目上这条踩过坑：有兼容桥接兜底时违规会长期无人察觉。
- 必带字段：`callId` / `roomId` / `uid`（有哪个带哪个）。
- **脱敏**：token 类凭据、完整 SDP、ICE 候选**不得整条打印**。
  用 `redact` / `redactSdp` / `redactCandidate`——**闸门会拦住不用它们的写法**。
  要看完整 SDP 用 Chrome 的 `webrtc-internals`，不要靠日志。
- **字段名用 `LogField` 常量**，别写字符串字面量：`room_id` / `roomId` / `room`
  三种写法同时出现在一份日志里就没法检索了。服务端有一份同名常量。
- **诊断环形缓冲不受 `setLogLevel` 影响**：用户报障时正好没开 debug 等于什么都没有。
  宿主做「报告问题」按钮时调 `exportDiagnostics()`。
- **媒体回调与统计轮询里禁止日志**（高频路径）。

## 7. 异步与资源

- 一律 `async/await`，不裸用 `.then` 链；**每个 `await` 的失败路径都要有处理**。
- 网络请求带 `AbortController`，组件卸载/通话结束时中止。
- 定时器/订阅**必须成对清理**，清理函数写在创建处旁边（不要隔几十行）。
- **不吞异常**：`catch` 里至少要 log 或转成用户可见状态，空 catch 块禁止。
- Promise 竞态要显式处理（后到的响应不许覆盖新状态）——用请求序号或 `AbortController`，
  别靠"应该不会发生"。

## 8. 媒体

- `getUserMedia` **只在 localhost / HTTPS 可用**，权限被拒要有明确的界面态与「重试」，
  **不弹 `alert`**。
- 轨道（`MediaStreamTrack`）用完必须 `stop()`；组件卸载、通话结束、切换设备都要走同一条清理路径。
- `RTCPeerConnection` 每个参与者最多两条（上行一条、下行一条），**不要每个 track 一条**。
- Safari 的 simulcast / H.264 行为与 Chrome 不同，**按实测处理并写进 `docs/`**，不要猜。

## 9. 测试与「完成的定义」

- **每加一个功能就配测试**。状态机与帧编解码是**必须**有测试的部分。
- 状态机跑 `im-rtc-server/docs/conformance/*.json` 的**一致性向量**，与另外四端同一份。
- 纯逻辑抽出来直接测（不经 React）；组件行为用 jsdom + Testing Library。
- **时序/订阅类行为一律写 jsdom 测试**，别在浏览器里靠肉眼。姊妹项目为此空跑过一整轮：
  浏览器面板隐藏时 `document.hidden=true`、rAF 冻结、程序化 `scrollTop` 不派发 scroll 事件。
- 媒体链路（真实 SFU 接通、simulcast 层切换）用 **Chrome `webrtc-internals`** 验证并截图存档，
  「画面出来了」不等于「层选择对了」。
- `./scripts/test.sh` 是唯一测试入口。

## 10. 提交与协作

- 提交信息格式：`类型(模块): 描述`，例如 `feat(uikit): 群通话九宫格发言高亮`。
  类型取 `feat / fix / perf / refactor / docs / test / chore`。
- **直接在 main 提交**（本项目约定，不先开分支）。
- 提交前 pre-commit 跑体量门禁；被拦了就拆分，别 `--no-verify`。

## 11. 不做什么（刻意的边界）

- **不做宿主业务界面**：消息气泡、会话列表、群横幅。Demo 的通话记录是示范不是要求。
- **不内置好友/联系人系统**：Demo 的联系人来自本地文件，宿主用自己的。
- **engine 不认业务概念**：只认 `userId` / `roomId` / `callId`，不认「群」「会话」「好友」。
  群名之类的展示信息由宿主经 `userData` 透传。
- **不引状态管理库 / UI 组件库**（Redux、MUI 之类）。SDK 要轻，宿主的技术栈不该被我们绑架。
- **不做屏幕共享（MVP）**：按钮先灰，后续期开。
