# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：只记当前状态，**就地覆盖、不追加**。历史见 `git log`。
> 工程规范见 [CONVENTIONS.md](CONVENTIONS.md)；方案与分期见 `im-rtc-server` 的
> `docs/design/RTC_CALL_DESIGN.md` §10；界面以草图 `docs/design/sketches/RTC_CALL_UX_SKETCH.html` §06 为准。

## 当前焦点

**仓库刚建（2026-09-03），只有文档与体量门禁，尚无一行代码。**

本仓在分期里是 **P2 —— 第一条端到端在这里跑通**，排在
P0 协议契约 → P1 SFU 最小可用之后，**在 iOS（P3）之前**。
**理由**：浏览器双开是最便宜的端到端验证场，SFU 与协议的坑先在这里踩完再上真机。

在 P0 协议契约（`im-rtc-server/docs/RTC_PROTOCOL.md`）落地前，本仓能做的只有工程骨架。

## 下一步

1. **等 P0**：`RTC_PROTOCOL.md` + `docs/conformance/*.json` 测试向量就绪。
2. **工程骨架**（可与 P0 并行）：npm workspaces 根 + 两个 package + demo；
   `tsconfig` 严格档（见 CONVENTIONS §3）；`scripts/check-file-size.sh` + `install-hooks.sh` + `test.sh`。
3. **P2 第一刀**：`signaling`（WS + 帧编解码 + 重连退避）与 `state`（状态机纯逻辑），
   **先跑通一致性向量**，此时还不需要媒体。
4. **P2 第二刀**：`media/WebRTCAdapter` + 1v1 语音 → 视频。
   验收：同一台机器两个浏览器接通、双向画面、静音/关摄像头互见、Chrome 限速下不断线。
5. **P2 第三刀**：uikit（来电 toast、1v1 浮窗、mini 浮窗）+ Demo 站点（登录/拨号/通话记录）。
6. **P4**：群通话九宫格，依赖服务端 simulcast 层选择就绪；用 `webrtc-internals` 验证层切换。

## 已知坑 / 限制

- **`getUserMedia` 只在 localhost / HTTPS 可用**。Demo 页面底部要写明；公网联调必须 HTTPS。
- **Safari 与 Chrome 的 simulcast / H.264 行为不同**：按实测处理并写进 `docs/`，不要猜。
- **时序类行为别在浏览器里靠肉眼判断**：浏览器面板隐藏时 `document.hidden=true`、rAF 冻结、
  程序化 `scrollTop` 不派发 scroll 事件——分不清是真 bug 还是探针死了。
  姊妹项目 im-web 为此空跑过一整轮。**一律写 jsdom 测试。**
- **effect 依赖的两个经典坑**（姊妹项目上的真实 bug，别再犯）：
  ① 回调型 prop 每次渲染都是新函数，列进 deps 会无限重跑 → 走 `useRef`；
  ② 定长窗口的 `length` 恒定，靠它判断"集合变了"永远不触发 → 用内容签名。
- **刷新丢失进行中状态**：File 句柄、MediaStream 不能跨刷新持久化；通话中刷新即掉线，
  这是平台规则，UI 要正确表现（重连而非假装还在）。
- **不引状态管理库 / UI 组件库**：SDK 要轻，不绑架宿主技术栈。

## 关联工程 / 常用命令

- 四仓（本地同级 `/Users/liying/IOSProject/im-rtc/`）：
  [im-rtc-server](https://github.com/BLiYing/im-rtc-server)（**协议契约在这里，只读引用**）·
  [im-rtc-ios](https://github.com/BLiYing/im-rtc-ios) · **im-rtc-web**（本仓）·
  [im-rtc-desktop](https://github.com/BLiYing/im-rtc-desktop)。
- 首批宿主（下游）：`../../im-web`（React + TS 的 IM Web 客户端）。
- 常用命令（脚本随骨架落地）：
  ```bash
  ./scripts/install-hooks.sh   # 新 clone 跑一次
  ./scripts/test.sh            # 唯一测试入口：体量 + tsc -b + vitest run
  npm run dev -w demo          # 起 Demo 站点
  ```
