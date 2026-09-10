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

**2026-09-10：修 code-review 抓到的「向量定位一路往上找到根」。** `test/vectors.ts` 的 `siblingDir()`
改成只算主检出 / `.claude/worktrees/<分支>` 两种布局下兄弟仓唯一该在的位置，找不到就抛；
`RTC_CONFORMANCE_DIR` 设了但不存在也抛，不再退回去猜。`temp_verify.py` 17 项全过（含旧版对照），`test.sh` 全绿。

**2026-09-09 晚：ICE 自愈补上放弃阈值，2006 从死码变成真出口（分支 `fix/parity-leave-failed-and-2006`）。**

扫四端静默失败点扫出来的：`mediaNegotiationFailed`（2006）**本仓此前只出现在 `errors.ts` 里**，
一个发射点都没有。`mediaPlane.ts` 的 `onPcState` 里，pub 判 failed 只重启不上报、
sub 判 failed **什么都不做**——下行永久失败在界面上完全无感：格子在、画面黑、计时照走。

按协议 §7.2 改成：pub 连续 `PUB_ICE_GIVE_UP`（3）次重启仍 failed 抛一次 2006，
之后继续重试但不再重复抛；sub 立即抛；回 connected 清零。
计数攥在 `mediaEvents` 的闭包里（一个页面可以起多个 Engine，模块级变量会串台）。

`./scripts/test.sh` 全绿（13 步，291 个 engine 用例），`test/engineIce.test.ts` 新增 4 条。

**2026-09-09 一整天：说话指示器改版 + 语音判定重做 + 四个真机 bug。全部已合入 main 并推送。**

> **没有一条经过真机验收**——除了下面单独标注的。真机清单见「下一步」。

### 这一轮做了什么

| # | 改动 | 提交 |
|---|---|---|
| 1 | **挂断后被邀请回同一通电话，本端媒体再也不发布了**。服务端复用同一个 `room_id`，而 `publishedRoomId` 这个 ref **全文件只有声明/读/写三处，从来没被清零过**——第二次进同一房间时发布 effect 直接 return，不发布、不报错、什么都不留。对端只看到首字母头像。真机 14:43 复现，iOS 一直是对的（`phase == .idle` 时清） | `ea00adc` |
| 2 | **说话指示器改版**（与 iOS/Android 同一份） | `3475c35` |
| 3 | **音量对条高一直没起作用**：CSS 层叠里「动画产生的声明」压过内联样式，耳语与大喊画出来一模一样。改走自定义属性 `--imrtc-peak` | `22772b9` |
| 4 | 跳过发布时留一条 debug 日志 | `7d166d7` |

### 测之前记得

**vite dev server 要重起** —— uikit 是按 `dist/` 被 demo 消费的，不重起还是旧的。
今天有一轮就是因为这个白测了。


## 下一步

- **本仓的静默失败点清单**（P0×3 / P1×7 / P2×7，2026-09-09 扫描）见
  `../im-rtc-server/docs/ops/silent-failure/web.md`，跨端结论与修复顺序见同目录的
  `SILENT_FAILURE_AUDIT.md`。**逐条状态只在那里维护，别抄回本文件。**
  未修的头两条：§A 发布/订阅被拒没有收场路径（四端同源）、呼出阶段按静音只改 UI 对方仍听得见。

### 真机验收（**这一整批一条都没验**）

按风险排序，前两条不过其余不用看：

1. **语音判定**（server）：`SPEECH_DEBUG=1 ./scripts/dev.sh` → 不说话时是不是真的不亮了；
   说话时亮不亮、条高随音量变不变；把 `margin` 的实测值发回来核门槛。
2. **说话指示器三态**：别人的格子「关 / 开着没说话 / 正在说话」，自己那格只有前两态；
   1v1 不显示说话但显示麦克风开关；多人同时说话每格各亮各的。
3. **Android 呼叫中按静音**：**接通前**按静音 → 对方接 → 确认对方听不见，
   且日志里有 `补做发布前攒下的静音`。（上次验成了「接通后按」，没走到修复那条路。）
4. **iOS 镜像**：翻到后置摄像头，自己看到的字不该是反的。
5. **web 挂断后重进**：bob 进群通话 → 挂断 → 再邀请回来 → 这次该看得到他的画面。
6. **通话时长**：群通话里中途加入的人退出后，记录里的时长是他自己那段，不是整通。
7. 之前那七条 code-review 修复也都没验（故障注入手册 `docs/ops/FAULT_INJECTION.md`）。

### 待办

- **下一个任务（已和用户对齐）**：四端扫一遍**静默失败点**——早退分支、被吞掉的异常、
  静默空实现。今天两个 bug 全是这一类（一句不吭的 `return`，界面/日志/报错三个观测面
  同时是瞎的）。只给真正可疑的加日志，判据卡死到「正常时一通电话最多出现一次」。
- **desktop 端说话指示器没做**：它 `MediaAdapter` 唯一实现是 `tests/FakeMediaAdapter.h`，
  libwebrtc 还没接进来，九宫格本身就是 ⬜。要等媒体面落地。
- **`CLIENT_PARITY.md` 没更新**：真机验完再改；验之前 iOS/Android 停在 🟡，不写 ✅。
- **web 端 `getUserMedia` 那类失败仍可能静默**：日志回传够不到浏览器 console。
- **iOS `Vectors.swift`、Android `call-engine/build.gradle.kts` 仍是「往上逐级找到根」**，
  和 web 修掉的是同一个问题（同级缺失时捡上层旧克隆）。要在各自仓里改。


## 已知坑 / 限制

- **2006 的阈值「3」没经过真机校准，而且它现在抛出来也没人接。** 两件事一起记（2026-09-09）：
  - **阈值待校准**：libwebrtc 判 `failed` 约 30 秒一轮，连续 3 次就是**一分半以后**宿主才知道，
    用户多半早挂了。真机弱网跑过之后很可能要调成 2 次、或者改成按时间而不是按次数。
    四端 libwebrtc 版本还不一样（iOS M152 / Android M150 / 桌面 M150 / Web 是浏览器自带），
    `failed` 的触发时机不见得对得齐——这条只有真机验得出来。
  - **目前它在界面上等于不存在**：四端 Kit 的错误出口都只认几个码
    （Web uikit 2 个、iOS `default: break`、Android `when` 没有 `else`），2006 落地即消失。
    所以现在**回归风险≈0，价值也≈0**，要等 Kit 那几个兜底补上才通。
  - 弱网环境暂缓搭建（2026-09-09 决定），有条件再做。

- **worktree 不在 `.claude/worktrees/` 下时，直接 `npx vitest` 找不到向量**（会抛错，不会读错）：
  设 `RTC_CONFORMANCE_DIR`，或走 `./scripts/test.sh`（它问 git 算好再传进去）。

- **「人先进来、轨道后到」是常态，不是异常**：格子挂载那一刻 `useRemoteTrack` 往往还是空。
  任何「挂载时顺手做一次」的 effect（层上报、尺寸、订阅）**依赖数组里都得带上 `hasVideo`**，
  否则轨道到了不会重跑——层上界为此空转过整整一版（`VideoTile` 已补）。

- **权限状态查询只用来决定要不要出说明卡，不用来判失败。** 判失败一律靠真探：Demo 的合成媒体源不走
  `getUserMedia`，浏览器说「已拒绝」而媒体层其实拿得到——信了查询就把能打的电话拦下来（本轮实测撞到）。
- **Safari 的 `getUserMedia` 必须在用户手势的调用栈里**：接听流程是「点接听 → 先探设备 → 再发 accept」，
  中间不能夹别的 `await` 网络请求。
- **没挂元素的人就是彻底静音**——engine 只把流挂到 `attachView` 给的元素上。语音版式、
  页内小窗、**九宫格里被截断的第 9 人起**都没有格子，声音全靠 `RemoteAudioSink` 那个隐藏
  `<audio>`，别删。**一个 uid 只能挂一个元素**（后挂的顶掉先挂的），所以画了格子的人不要再给 sink，
  也别让「谁上格子」跟着 `activeSpeakers` 抖——每抖一次就是一次 `srcObject` 重挂。
- **中间态一定要有回滚**：帧发不出去（没连接）或被服务端拒掉时，状态机必须收到对应的
  `*_failed`，否则界面停在转圈屏、之后每个动作都被拒成 2005。表在 `frameLoop.rollback`，
  与 Android 的 `onRequestFailed` 逐条对齐。
- **解不动的下行帧按原始 data 放行，绝不往上抛**：抛在 `PendingRequests.settle` 里会让
  `request()` 的 promise 永不落定（waiter 已摘、超时已清）。
- **停 Demo 用 Ctrl+C，别用 Ctrl+Z**：Ctrl+Z 把整个进程组挂起（`STAT=T`），挂起的 vite
  仍然持有 listen socket 却不响应任何请求，下次启动只报 "Port is already in use"，
  curl 上去是连得上、然后零字节超时。这种进程收不到 SIGTERM，SIGCONT 唤醒后又会因后台读 tty
  收到 SIGTTIN 再次挂起，只能 `kill -9 -<pgid>` 杀整组。走 `./scripts/dev.sh` 会自动回收。
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
  npm test                                         # = 上面两条；根目录没有 vitest 配置，不能裸跑 vitest
  npm run dev                                      # 自画 UI 的 Demo（:5178），前台，终端能看实时输出
  npm run dev:react                                # 引 uikit 的 Demo（:5179），同上
  ./scripts/dev.sh [start|stop|status|logs] [demo|react]   # 后台起停，先杀后起、幂等
  ```
  两条路线二选一：`dev.sh` 后台起、日志进 `dev-logs/`（要 `./scripts/dev.sh logs react` 才看得到
  实时输出），换来的是**端口被残留进程占着会自动回收**，不用手动 lsof + kill。
- 浏览器实测要点：两个标签页各登一个用户并**勾上「合成音视频源」**（Browser 面板里拿不到真麦克风）。
