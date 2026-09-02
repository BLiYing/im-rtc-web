# im-rtc-web

`im-rtc` 音视频产品的 **Web 客户端 SDK**，TypeScript（`strict`）。

| 包 / 产物 | 是什么 |
|---|---|
| **`@im-rtc/call-engine`** | **无 UI**、**框架无关**核心：信令 / 状态机 / 媒体 / 设备，能力通过**事件**暴露 |
| **`@im-rtc/call-uikit-react`** | **整套通话 UI**：来电 toast、1v1 浮窗、群通话九宫格、mini 浮窗 |
| **Demo 站点** | 登录 / 拨号 / 通话记录，两种集成方式各跑一遍 |

媒体用浏览器内置 WebRTC，**零媒体依赖**。

## 两种集成方式

- **只引 engine**：拿事件，界面自己画（Vue / Svelte 也能用，engine 框架无关）。
- **engine + uikit**：整套 UI 直接用。

**uikit 不是特权组件**——它只消费公开事件表，没有私有通道。

## 边界

**不做宿主业务界面**（消息气泡、会话列表、群横幅）。Demo 的通话记录是**示范**，不是要求。

## 文档

| 文档 | 内容 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | 项目说明、结构、工作流程与「完成的定义」 |
| [CONVENTIONS.md](CONVENTIONS.md) | 工程规范（分层 / 体量 / **TS 严格性** / **React 纪律** / 测试） |
| [current_task.md](current_task.md) | 当前进度活快照 |
| 协议契约 | 在 [im-rtc-server](https://github.com/BLiYing/im-rtc-server) 的 `docs/RTC_PROTOCOL.md`，本仓只读引用 |

## 开发

```bash
./scripts/install-hooks.sh   # 新 clone 跑一次
./scripts/test.sh            # 体量门禁 + tsc -b + vitest run（P2 落地后可用）
npm run dev -w demo          # 起 Demo 站点
```

**`getUserMedia` 只在 localhost / HTTPS 可用。**

## 状态

**P2 —— 第一条端到端在这里跑通**（浏览器双开是最便宜的验证场），当前只有文档与体量门禁。
