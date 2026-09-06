# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：只记当前状态，**就地覆盖、不追加**。历史见 `git log` 与
> [current_task.archive.md](current_task.archive.md)（只读归档，2026-09-05 搬入）。
> 工程规范见 [CONVENTIONS.md](CONVENTIONS.md)；方案与分期见 `im-rtc-server` 的
> `docs/design/RTC_CALL_DESIGN.md` §10；**界面以设计稿 v3 为准**：
> `../im-rtc-server/docs/design/sketches/RTC_CALL_UI_SPEC.html`（令牌 / 图标 / 组件红线）与
> `RTC_CALL_UX_FLOWS.html`（权限 / 小窗 / 互换 / 加人），两稿与 v2 草图冲突时以 v3 为准。

## 当前焦点

**uikit 按设计稿 v3 落地（2026-09-05）**，`./scripts/test.sh` 13 步全绿，uikit 89 个用例 + engine 183 个。
浏览器实测（两个标签页 + 本地 SFU + 合成媒体源）：视频拨出带本端预览 → 接通 → 单击小窗互换
→ 收进页内小窗 → 群呼三人九宫格（占位格 / 发言描边 / 加号格）→ 选人半屏。

这一轮落地的（对应 UI_SPEC §09 的 12 处差异，Web 侧全部完成）：

| 块 | 落点 | 内容 |
|---|---|---|
| 令牌 | `theme.ts` | 11 个语义色 / 尺寸 / 动效时长 / 九色头像板；`styles.ts` 只做排布，**组件里不再有字面色值** |
| 图标 | `iconShapes.tsx` + `Icon.tsx` | 19 个 24×24 内联 SVG（与稿 §05 逐条一致，四端唯一真相）；`NetworkBars` 三档 |
| 头像 | `format/avatar.ts` | `fnv1a32(uid) % 9`，向量写在 `avatar.test.ts` 供 Swift / Kotlin 对表 |
| 权限 | `state/permissions.ts` + `usePermissionGate.ts` | 三段式：说明卡 → 探测 → 分支。**麦克风被拒整通取消、摄像头被拒降级为语音继续** |
| 小窗 | `layout/pip.ts` + `usePipDrag.ts` + `PipView.tsx` | 四角吸附、控制条避让上移 88、手机长按 350ms 才拖、桌面直接拖 |
| 互换 | `VideoStage.tsx` + `isSwapped` | 单击小窗 A/B 互换，纯本端；**层上界跟着换**（进小窗报 l） |
| 版式 | `ActiveCall.tsx` 的 `pickLayout` | audio / video / grid 三种；两端都关摄像头退回语音版式；视频版式控制条 3s 自动隐藏 |
| 加人 | `GridStage.tsx` + `InvitePicker.tsx` + `engine.inviteMore` | 加号格 + 右上按钮**只有主叫可见**；占位格「呼叫中… / 已拒绝 / 未接听」停 2s 再收；1202 / 1407 分支 |
| 页内小窗 | `MiniWindow.tsx` | 180 宽、可拖四角吸附、角落记在 sessionStorage；其余人的声音走 `RemoteAudioSink` |
| 横幅 | `TopBanner.tsx` + `connection` | 正在重连… / 连接已断开 / 对方网络不佳（2s 后收成角标） |
| 收尾 | `CallProvider.tsx` | `beforeunload` 发 hangup，不留幽灵成员 |

engine 新增两个公开方法（五端同名，设计文档 §7.5 已同步）：`inviteMore(calleeIds)`、
`probeMicrophone()`（`MediaAdapter.probeMicrophone`：只探权限、拿到即放，**一个会话只探一次**）。

**`/code-review` 抓到 7 条，全部已修 + 配了回归**（同一类问题在 iOS / Android 也一并修了）：
① `toggleCamera` 里 `publishCamera` 抛错没人接——界面已经把按钮点亮了，而对端什么也没收到；
② 加人被服务端拒（1407 / 1202）时占位格收不回来，一直挂着「呼叫中…」还占着人数；
③ 提示（「通话已满员」）**永不过期**，在标题栏里永久顶掉计时器——现在 3s 自撤且只清自己那条；
④ `probeMicrophone` 每拨一次号就向媒体源要一份新流，Demo 的合成源每份漏一个 AudioContext
（浏览器有个位数上限，几通之后麦克风就发布不出去了）——改成一个会话只探一次；
⑤ 终局计时器整批重建，后一个人拒接会把前一个人的 2 秒重新计一遍；
⑥ `beforeunload` 里 `preventDefault()` 让每次刷新都弹确认框，换来的却是不保证送达的一帧；
⑦ 小窗在容器量出来之前先画在左上角，再滑到右上角。

## 下一步

- **浏览器复测本轮修的四条**：开摄像头失败的降级、加人被拒后占位格收回、提示 3s 自撤、
  小窗首帧不再从左上角弹出去。
- iOS / Android 已按同一份稿落地（见各自的 `current_task.md`），**都还没真机验**。
- Demo 还没演示的：主动换设备、桌面独立窗口（那是 desktop 仓的事）。
- 预警线上的三个文件：`signaling/connection.ts` 382、`engine.ts` 386、`state/roomMachine.ts` 347（上限 400）。
  **下一次动它们时先拆。**

## 已知坑 / 限制

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
