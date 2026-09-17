# current_task 归档（只读）—— im-rtc-web

> 2026-09-05 从 `current_task.md` 整体搬来。之后的历史看 `git log`。


## 2026-09-17 夜（调用结果改造开工时移出活快照）：「当前焦点」

> 原文照录，正文未改。

**2026-09-17 傍晚：四仓 /simplify 清理做完并推送（本仓 `323abe4`…`354b265`，`test.sh` 16 步全绿：engine 432 / uikit 212 / demo-react 20 例；用户已复看，正常）。**
- `323abe4` `applySpeakers` 没变就返回原 state / 原引用，`VideoTile` / `SpeechIcon` / `NetworkBars` 包 memo——止住 300ms 全量重渲染（VideoTile 读 context，memo 挡不住它，收益主要在子组件）。
- `useKeyedTimers` 合并 `CallProvider` settledTimers 与 `useVideoRevealFallback`；`maxParticipants` → `MAX_TILES`、VideoStage 用 `focusedLayer`、`isNetworkBad`；`CallEnded` 拆 if/return；`useCallActions` 删冗余依赖。
- Demo（行为变化）：demo 与 demo-react 的 `api.ts` 合并成 `@demo/api`；demo-react 通话记录改用 `endReasonText`（未知原因显示「已结束」）；`remoteLog` 的 pagehide 监听 stop 时摘掉。
- 09-17 下午四条（destroy 对表、体量两刀、铃声 AbortError、拨号卡片）已移进 archive。

## 2026-09-17 傍晚（/simplify 清理收口时移出活快照）：「当前焦点」里更早的块

> 原文照录，正文未改。

**2026-09-17 下午：旧「下一步」2（destroy 对表）、4、5、6 四条做完并推送，`test.sh` 16 步全绿。**
- `343dcc3` 铃声 `play()` 被本端 `pause()` 打断（`AbortError`）记 debug，只有 `NotAllowedError` 才说「被拦下」。
- `a9cb938` 体量 / 日志门禁按 `package.json` workspaces 推扫描目录（`scripts/lib/workspaceDirs.sh`），demo-react 不再漏扫；读不出 workspaces 时 exit 2。
- `2b2017a` `webrtcAdapter.ts` 529 → 449（`media/videoSender.ts`、`media/captureStream.ts`）。
- `c257177` `engine.ts` 582 → 470（`callGuards.ts`、`engineSession.ts`、`engineMediaApi` 的 `openLocal` / `closeLocal`）；destroy 之后逐方法归类钉进 `test/destroyContract.test.ts`，三端对照写进 CLIENT_PARITY v1.39 `[^destroy]`（server `fd7b38d`）。
- `77146f5` demo-react 设置补「静音来电铃声」（对齐 iOS / Android Demo，接 `<CallProvider ringtoneMuted>`、存 localStorage）；勾选 + 刷新保持已验，真来电静音没点过。桌面 Demo 不放铃声，不加。
- `7f183f3` demo-react 拨号卡片四段统一骨架（标题 / 控件行 / 说明，按钮收右侧固定宽一列），会议说明挪到会议段下；用户验过：各按钮实际点通（呼叫、新建 / 加入会议）、窄屏布局正常。
- 09-17 夜那三件（`call.ringing` 占位格、会议房 M1、网络横幅只在 1v1）见 git log，已真实验过。


## 2026-09-17（SDK 1.0.0 公网发布后精简）：精简前全文

> 2026-09-17 SDK 1.0.0 四端公网发布、五仓推送之后，`current_task.md` 整份重写成一屏快照；下面是重写前原文照录（标题降两级，正文未改）。

### Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：就地覆盖、不追加。历史见 `git log` 与 [current_task.archive.md](current_task.archive.md)（新的在上，顶节「2026-09-16 夜（SDK 改名 / IMRTC_SDK 三档开关前）」）。
> 规范 [CONVENTIONS.md](CONVENTIONS.md) · 分期 server `docs/design/RTC_CALL_DESIGN.md` §10 ·
> 界面以设计稿 **v3.1** 为准：`../im-rtc-server/docs/design/sketches/RTC_CALL_UI_SPEC.html` / `RTC_CALL_UX_FLOWS.html`。
> ✅ 状态只写在 `../im-rtc-server/docs/CLIENT_PARITY.md`。

#### 当前焦点

**2026-09-16（第四轮，已提交（标题「构建: SDK 公网发布准备」，未推送），代码审查零问题，未上真端）：SDK 改名 + npm 公开发布准备 + `IMRTC_SDK` 三档开关。** `./scripts/test.sh` 15 步全绿（engine 393 / uikit 195 / demo-react 17）。

- **包改名为不带作用域**：engine 包名改成 `im-rtc-call-engine`，uikit 包名改成 `im-rtc-call-uikit-react`
  （原先各自挂在 `im-rtc` 这个 npm 作用域下，但该作用域被别人占了，公开发布只能用不带作用域的包名；版本仍 1.0.0）。
  全仓 grep 旧的作用域包名清零（`current_task.archive.md` 除外，历史不改）；
  两个包 `package.json`、两个 Demo 的 import / tsconfig paths / vite alias、`temp_verify.py`、`CLAUDE.md` / `CONVENTIONS.md` / `README.md` 都跟着改了名。
  `npm install` 重建过 `package-lock.json` 与 `node_modules` 软链（`node_modules/im-rtc-call-engine` → `packages/call-engine`）。
- **`publishConfig.access` 两个包都改成 `public`**（原先 `restricted`）。**`license` 定了 MIT**（用户拍板）：
  两个包 `package.json` 的 `license` 从 `UNLICENSED` 改成 `"MIT"`；仓根新增 `LICENSE`（MIT，Copyright (c) 2026 BLiYing），
  另外复制进 `packages/call-engine/LICENSE`、`packages/call-uikit-react/LICENSE`——**必须每个包自己目录下都有一份**，
  npm 只自动打包"包自己目录里"的 LICENSE，monorepo 根那份不会跟着 `npm pack` 进去。`npm pack --dry-run` 已确认两个包的
  清单里都多了 `LICENSE`（218 / 202 个文件），`check-pack.sh` 照常 ✓ 干净（它的坏文件正则不认 LICENSE，不会误报）。
- **新增 `IMRTC_SDK=source|local|public` 开关**（环境变量，默认 `source`，即现状：别名直接指到 `src`）：
  - `scripts/lib/sdkAlias.ts`：两个 `vite.config.ts` 共用的解析逻辑（避免各写一份走样）。`source` 档指到 `packages/<pkg>/src/index.ts`；
    `local` / `public` 档指到 `.sdk-release/<档>/node_modules/<包名>` 的**包根目录**（让 vite 按包的 `exports` 字段解析，和真实宿主一样）；
    目录不存在直接抛错，提示先跑 `pack-sdk.sh`。两个 `vite.config.ts` 都加了 `resolve.dedupe: ['react', 'react-dom']`，
    启动时打一行 `console.log`（`[demo]` / `[demo-react]` 前缀）：「Demo 用的 SDK：源码 / 本地包 <路径>（<包名@版本>…）/ 公网包 <包名@版本>…」。
  - **新脚本 `scripts/pack-sdk.sh local|public`**：
    - `local`：`npx tsc -b` build 两个包 → `npm pack --pack-destination` 打 tgz → **手工 `tar` 解包**（不跑 `npm install`）进
      `.sdk-release/local/node_modules/<包名>`——不跑 install 就没有 peer 依赖可装，天然满足「不要装 peer 依赖」这条要求，
      落地结构等价于真实 `npm install` 后宿主 `node_modules` 里看到的样子。
    - `public`：`npm install --no-save --no-package-lock --omit=peer --prefix .sdk-release/public <包名>@<版本>`（版本读包的
      `package.json`）。包不存在时脚本会识别 404/E404 并打印「还没发布到 npmjs」，不是让人干瞪着一坨 npm 原始报错猜。
    - `.sdk-release/` 已加进 `.gitignore`。
  - **类型检查按包的 `.d.ts`**：`demo/tsconfig.sdk-local.json`、`demo/tsconfig.sdk-public.json`、`demo-react/` 同名两份——都
    `extends` 各自的 `tsconfig.json`、只覆盖 `paths`（指到 `.sdk-release/<档>/node_modules/<包名>/dist/index.d.ts`）。
    `npm run typecheck:sdk-local` / `typecheck:sdk-public`（根 `package.json` 新脚本）各一条命令跑两个 Demo。
  - **`scripts/check-logging.sh`** 给 `*/vite.config.ts`、`*/vitest.config.ts` 加了 console 豁免（这俩文件打的是构建期一次性
    提示，不是业务日志，跟 CONVENTIONS §6 那套字段名 / 脱敏约束不相干）——不加的话 `demo/vite.config.ts` 在扫描范围内会被拦。
  - **`scripts/test.sh` 新增第 15 步「本地包档校验（IMRTC_SDK=local）」**（离线可跑，不碰 registry）：
    `pack-sdk.sh local` → 两个 Demo 按包类型检查 → 两个 Demo 在 `IMRTC_SDK=local` 下 `vite build` 成功。
    默认 `source` 档原有 14 步不变；`public` 档要连网，不进 `test.sh`，发版后人工照「常用命令」自己跑。
  - `scripts/check-pack.sh` 不用改——它用 `require(...).name` 动态读包名，改名对它透明。
- **验证（都真跑过）**：
  - 负向证明本地包档没用源码：`IMRTC_SDK=local` 下两个 Demo 的 build 产物（`demo/dist/assets/*.js`、`demo-react/dist/assets/*.js`）
    `grep -c "packages/call-engine/src\|packages/call-uikit-react/src"` 都是 0。
  - 负向证明类型检查真的在读包：临时从 `.sdk-release/local/node_modules/im-rtc-call-engine/dist/index.d.ts` 删掉
    `export { WebRTCAdapter } ...` 这一行 → `npx tsc --noEmit -p demo/tsconfig.sdk-local.json` 立刻报
    `TS2305: has no exported member 'WebRTCAdapter'` → 重新 `./scripts/pack-sdk.sh local` 后恢复绿。
  - `npm pack --dry-run` 两个包清单只有 `dist/` + `package.json` + `LICENSE`（218 / 202 个文件，`dist/` 各 216 / 200 个），没有 `src/`、`test/`。

#### 下一步

0. ~~发布后验公网包~~：2026-09-17 两个包已发 npm 1.0.0（用户在终端用通行密钥发的——`npm publish` 要 2FA，Claude 这边没 TTY 发不了），`pack-sdk.sh public` + 两个 Demo 按包类型检查 + vite build 都过；仓外空工程只装 uikit 也带上 engine。
2. 用户自测（服务端先重启）：发起人挂断后，被叫在选人页能选到他并邀请；他那边来电页不出现自己的格子。自测过了跑 `./scripts/test.sh` 再提交。
3. API 命名对齐遗留：`engine.ts`（582 行）与 `media/webrtcAdapter.ts`（529 行）体量 WARN，再往里加东西前先拆；
   `destroy()` 之后哪些方法抛 2005 没和 iOS / Android 逐条对表；`openMicrophone` / `openCamera` 等四个开关只有 engine 层单测、没在真浏览器点过。

#### 已知坑 / 限制

- **`IMRTC_SDK` 三档只影响两个 Demo 的 `vite.config.ts`，不影响 `packages/` 本身**：`tsc -b`、`vitest run --root packages/*`
  永远编译 / 跑的是源码，与这个开关无关；开关管的是「Demo 怎么导入 SDK」，不是「SDK 怎么被测」。
- `.sdk-release/local|public/node_modules/<包名>` 不存在时两个 `vite.config.ts` 直接抛错（不是静默回落到 source）——
  先跑 `./scripts/pack-sdk.sh local` 或 `public`。`pack-sdk.sh` 每次都会 `rm -rf` 重建对应档，不是增量装，不用自己先清。
- **`demo-react/` 不在 `check-logging.sh` / `check-file-size.sh` 的扫描范围内**（老漏洞，未修，这次顺手确认过）：
  `for d in packages demo` 只扫这两个目录。`demo-react/vite.config.ts` 的 `console.log` 因此天然不会被拦；
  `demo/vite.config.ts` 在扫描范围内，全靠新增的 `*/vite.config.ts` 豁免才没被拦——以后改 `check-logging.sh` 的豁免表时留意别删掉这条。
- **`callCancelled` 的公开事件字段是 `uid`，但线路帧 / 状态机内部回调参数仍是 `by`**（一致性向量
  钉死，四端共用）：新加 callMachine 相关代码或读 `call_fsm.json` 时**不要**假设两边字段名一致，
  翻译只发生在 `engineBus.ts` 的 `emitMachine` 里那一条特例分支。
- **`destroy()` 之后各方法的行为不是完全统一的一刀切**：多数方法抛 `2005`，但 `logout()` /
  `forceEnd()` / `on()` / 读或清理类方法始终安全——写新的公开方法时想清楚它属于哪一类，别默认
  抄别的方法的 `assertNotDestroyed()` 用法。
- **"发布过没有"必须问 `MediaAdapter`，不能在 `engine.ts` 自己记账**：`WebRTCAdapter` 的
  `publishedMicrophoneCid()`/`publishedCameraCid()` 是唯一真相源，`micCid` 字段与 `acquire()`
  同步维护、`close()` 里清零——任何新增的"按类型查询发布状态"的需求都应该复用这两个方法，
  而不是新开一份字段。
- **`FrameLoop.sendFrame` 从不把服务端拒绝转成异常**：`call()` / `joinCall()` / `inviteMore()` 这类
  「发一帧、等应答」的门面方法在被服务端拒绝时永远 `resolve`，不会 `reject`——失败只经由 `error` 事件
  + 随后的状态机收场（`call_failed` → `onCallEnd`）体现。**写宿主代码或测试时不要用 `try/catch` 猜失败**，
  订阅 `error` 事件或看状态机的落地状态。
- **2006 阈值「3」未校准、uikit 只认 2 个错误码**：见 server「已知坑」。
- **关摄像头停采集**：通话中关 = `track.stop()`，开 = 重新 `getUserMedia` 再 `replaceTrack` 到同一个 sender（transceiver / msid / cid 不变、不重协商）；开关串行（`cameraToggle`），`close()` 后才回来的按代数自己收摊；
  重新采集被拒时错误原样抛给调用方。`stopLocalPreview()` 不停 `cameraClaimed`（正在发布 / 已发布）的；等在起的那次落地再停，期间又有人要预览就听后来的（`previewIntent`）。
- worktree 不在 `.claude/worktrees/` 下时，直接 `npx vitest` 找不到向量（抛错不读错）：设 `RTC_CONFORMANCE_DIR`，或走 `./scripts/test.sh`。
- **对端重开摄像头要等新帧上屏才揭示**：`requestVideoFrameCallback` 对 `visibility:hidden` 的元素可能不回调，所以等待时 `<video>` 保持可见、靠头像盖住，别改成藏起来；
  浏览器没有这个 API 就立刻揭示（退回旧行为）；后台标签页不出帧靠 2 秒兜底；首次进房也走同一道闸。
  **rVFC 回调了不等于新画面**：关时藏起来的元素积压着没上屏的旧帧，一可见就补上屏，必须按 `receiveTime` 挡掉。
- **「人先进来、轨道后到」是常态**：挂载时顺手做一次的 effect（层上报、尺寸、订阅）依赖数组里得带 `hasVideo`（`VideoTile` 已补）。
- 权限状态查询只决定要不要出说明卡，判失败一律靠真探（合成媒体源下浏览器说「已拒绝」其实拿得到）。
- Safari 的 `getUserMedia` 必须在用户手势调用栈里：「点接听 → 先探设备 → 再发 accept」，中间不能夹别的 `await` 网络请求。
- **没挂元素的人就是彻底静音**：语音版式、页内小窗、九宫格第 9 人起的声音全靠 `RemoteAudioSink` 的隐藏 `<audio>`，别删。
  一个 uid 只能挂一个元素，画了格子的人不要再给 sink；别让「谁上格子」跟着 `activeSpeakers` 抖（每抖一次一次 `srcObject` 重挂）。
- **中间态一定要有回滚**：帧发不出去或被拒时状态机必须收到 `*_failed`，否则停在转圈屏、之后每个动作 2005。表在 `frameLoop.rollback`，与 Android `onRequestFailed` 逐条对齐。
- 解不动的下行帧按原始 data 放行、绝不往上抛（抛在 `PendingRequests.settle` 里 `request()` 的 promise 永不落定）。
- 下行 call 帧必须按 call_id 过滤（第三方呼叫的 `call.ended{busy}` 带新来那通的 id）。
- **停 Demo 用 Ctrl+C，别用 Ctrl+Z**：挂起的 vite 占着端口不响应（"Port is already in use"、curl 零字节超时），只能 `kill -9 -<pgid>`。走 `./scripts/dev.sh` 会自动回收。
- jsdom 25 没有 `PointerEvent`（`test/setup.ts` 用 `MouseEvent` 垫）；jsdom 里容器是 0×0，拖动用例只验逻辑不验坐标。
- **jsdom 下用 `vi.useFakeTimers()` 时，纯 `await Promise.resolve()`（哪怕连做几次）不会让 `setTimeout(fn, 0)` 落地**，得显式 `vi.advanceTimersByTimeAsync(...)`；**真实定时器**下则要用
  `await new Promise((r) => setTimeout(r, 0))` 这种真的让出一次宏任务的写法，光 `act(async () => { await Promise.resolve(); })` 在系统负载高时不稳定（`hostIntegration.test.tsx` 的分页用例踩过一次）。
- `getUserMedia` 只在 localhost / HTTPS 可用，公网联调必须 HTTPS。
- 便利事件只在 1v1 抛，群通话只抛 `onUser*`；加人失败靠 `error` 事件的 1202 / 1407 / 1409。
- effect 依赖看内容签名不看 length（`settledUids`）；回调型 prop 走 `useRef`。
- 状态机 `args` 一律 snake_case（与向量、另外三端同名），转 camelCase 是 `engineBus` 的活（但见上面
  `callCancelled` 那条例外）。
- `packages/call-engine/src/` 里不能放 `*.test.ts`（会被 `tsc -b` 算进 build），测试放 `test/`。
  **`test/` 目录本身不在任何 `tsconfig` 的 `include` 里**，`tsc -b` 不会类型检查测试代码——
  写测试假实现（`implements MediaAdapter` 之类）时接口改了要自己记得同步，门禁不会提醒你。
- 换 token 是宿主的事（协议 §1.5），engine 只提供 `updateToken`；发送侧一律 `newFrameData(FIELDS)` 起手（§2.4 默认值陷阱）。
- 画质是宿主策略（`videoProfile`），改档位同步服务端 `bwe.go` 的 `bitrateHigh`。
- SDK 版本号改 `packages/call-engine/src/version.ts`（`SDK_VERSION`）+ 两个 `package.json`（五端统一 1.0.0，握手 `web/1.0.0`）。
  demo-react 设置存 localStorage（双开共用），登录态仍是 sessionStorage；它的 vitest 已进 test.sh，但**体量门禁与日志门禁都不扫 `demo-react/`**（老漏洞，未修）。

#### 关联工程 / 常用命令

- 协议契约与一致性向量：`../im-rtc-server/docs/RTC_PROTOCOL.md` 与 `../im-rtc-server/docs/conformance/`，只读引用。
- 宿主对接设计：`../im-rtc-server/docs/design/HOST_INTEGRATION_DESIGN.md`（M1/M2/M8 的依据，§3）。
- 起服务端联调：`cd ../im-rtc-server && ./scripts/dev.sh`（控制面 :8787，媒体面 UDP 7881）。
- 浏览器实测：两个标签页各登一个用户并**勾上「合成音视频源」**（Browser 面板里拿不到真麦克风）。
  ```bash
  ./scripts/install-hooks.sh                       # 新 clone 跑一次
  ./scripts/test.sh                                # 唯一测试入口（15 步，含 IMRTC_SDK=local 校验）
  npx vitest run --root packages/call-engine       # 只跑 engine 测试
  npx vitest run --root packages/call-uikit-react  # 只跑 uikit 测试（jsdom）
  npm test                                         # = 上面两条；根目录不能裸跑 vitest
  npm run dev                                      # 自画 UI 的 Demo（:5178），前台，IMRTC_SDK 默认 source
  npm run dev:react                                # 引 uikit 的 Demo（:5179），前台，IMRTC_SDK 默认 source
  ./scripts/dev.sh [start|stop|status|logs] [demo|react]   # 后台起停，先杀后起、幂等，日志进 dev-logs/
  ```
- **`IMRTC_SDK` 三档怎么用**（验证「发出去的包本身能用」，Demo 在后两档里等于一个第三方宿主）：
  ```bash
  # source（默认）：不用做什么，改 packages/*/src 立刻在 Demo 里看到效果。

  # local：验证「打出来的 tgz 能用」，不用发布、不用联网。
  ./scripts/pack-sdk.sh local                       # build 两个包 → npm pack → 解包进 .sdk-release/local
  npm run typecheck:sdk-local                       # 两个 Demo 按包的 .d.ts 类型检查
  IMRTC_SDK=local npm run dev -w demo               # 或 dev -w demo-react；启动日志会打一行「本地包 <路径>」
  IMRTC_SDK=local npm run build -w demo-react        # 验证能 build（test.sh 第 15 步已经跑这个）

  # public：验证「发布到 npm 之后能用」，需要联网；两个包发布前必现 404（预期行为）。
  ./scripts/pack-sdk.sh public                      # npm install --omit=peer 从 registry 装
  npm run typecheck:sdk-public
  IMRTC_SDK=public npm run dev -w demo-react
  ```


## 2026-09-16 夜（SDK 改名 / IMRTC_SDK 三档开关前）：静默失败审计 §A + 来电铃声 + 重新邀请发起人 + API 命名对齐

2026-09-16 深夜被「SDK 改名 + npm 公开发布准备」挤下 `current_task.md` 前的原文，照录。

### 当时的「当前焦点」

**2026-09-16（第三轮，已提交（`git log` 里标题为「call: 发布 / 订阅被拒要收场」那笔），未上真端）：静默失败审计 §A——发布 / 订阅被拒要收场。** `./scripts/test.sh` 14 步全绿（engine 393 条）。
- `frameLoop.ts` 的 `rollback` 改收整帧：`room.publish` 被拒且通话机非 idle → `forceEnd(now, CallEndReason.error)`；否则内部事件 `publish_failed{cid}`；`room.subscribe` 被拒 → `subscribe_failed{track_id}`。
- `MachineInput` 的 internal 加可选 `args`；`engineMachine.ts` 用 `ROOM_FAILURES` 把四条失败统一路由给房间机；`roomMachine.ts` 新增 `dropFailedPublish` / `dropFailedSubscribe`；`state/forceEnd.ts` 加可选 reason 覆盖。
- 用例：`failureRecovery.test.ts`「发布被拒要收场」两条、`roomMachine.test.ts`「房间帧被拒的回滚」两条。负向验证：撤掉 `frameLoop.ts` 后两条端到端用例变红。

**2026-09-16（第二轮，已提交 `9c6efac`，真机验收通过）：来电铃声 + 回铃音。** `./scripts/test.sh` 14 步全绿（uikit 17 文件 195 条，含新增 11 条）。
- **素材走 base64 常量**：`packages/call-uikit-react/src/audio/ringtoneAssets.ts`（61KB，32 行）。**不是懒**——本包的构建只有 `tsc -b`，
  没开 `allowArbitraryExtensions`、`tsc` 也不拷非 TS 文件，`import ring from './x.mp3'` 在当前配置下**直接不成立**；
  加打包步骤要动 `files` / `exports` / demo-react 的 alias-to-src，风险比 61KB 常量大。体量门禁按行数算，单行 base64 不触红线。
- 纯判据 `ringtoneFor(state, muted)` 在 `state/callView.ts`（`RingtoneKind` 在 `viewTypes.ts`），三端同名同义：
  `muted` / `isMeeting` → `'none'`；`incoming` → `'incoming'`；`outgoing` → `'ringback'`；其余 `'none'`。
- 播放 `src/useRingtone.ts`（骨架复刻 `useRingingPreview.ts`），在 `CallProvider` 里与它并排调用；`new Audio()` + `loop`，
  **不接进 `engine.attachView` 体系**（那是远端轨道的）。起停靠 effect 依赖 `[kind, …]` 驱动，cleanup 里 `pause()` + `currentTime = 0`。
- 三个可选 prop 照 `bannerFirst` 五步走：`incomingRingtone` / `ringbackTone` / `ringtoneMuted`（默认 false）。
  **Web 上 `ringtoneMuted` 改了立刻生效**（响铃中也会停），iOS / Android 要等下一次起铃——那是各端配置机制本来就有的差别，同 `bannerFirst`。
- **自动播放策略是硬限制**：来电时通常没有用户手势，`play()` 会被拒。只 `logger.warn`，静音继续通话，不做用户可见错误态。
  `test/setup.ts` 里 stub 了 `HTMLMediaElement.prototype.play`/`pause`/`load`（jsdom 25 的 `play()` 不返回 Promise，`.catch()` 会 TypeError）。
- 小瑕疵（未修）：`play()` 落定前被 cleanup 的 `pause()` 打断会抛 `AbortError`，被同一个 `.catch` 接住 → 快速挂断时日志里会多一条
  「自动播放被拦下」的**误导性**记录。行为无害，只是日志会骗人。

**2026-09-16（第一轮，已提交 `44d1529`）：离场的发起人可以被重新邀请。** 服务端去掉了 `invite_more` 对发起人的 `bad_params`（见 server current_task）。本仓：
- `InvitePicker.tsx` 去掉「暂时无法邀请」分支与手输 uid 时对发起人的排除，离场的人（含发起人）照常可选。
- `callView.ts` 的 `callReceived` 加可选 `selfUid`（`subscribeEngine.ts` 传 `engine.uid`）：发起人就是自己时不给自己摆格子。
  来电页显示 `participants[0]`，被重新邀请的发起人看到的是通话里某个被叫的名字。`engine.ts` 的 `inviteMore` 注释跟改。
- 测试：`interactions.test.tsx` 改为断言离场的发起人可选并能邀请；`callView.test.ts` 新增「caller 就是自己不摆格子」。
  只跑了 `tsc -b`、demo-react 类型检查与 `callView` / `interactions` / `hostIntegration` 三个文件（68 条过），`test.sh` 全量没跑。

- **协议新增 `call.incoming.inviter`**（同批已提交 `44d1529`，四端同改）：「谁把你拉进来的」，首次邀请就是 `caller`，群通话里被别人加进来时是那个人；旧服务端不带就回落 `caller`（engine 兜好，宿主不用判空）。
  `events.ts` 的 `callReceived` 加 `inviter`、`callRecv.ts` 解析并回落；`CallViewState.inviterUid`（`viewTypes.ts` / `callView.ts` / `subscribeEngine.ts`）；来电横幅 `IncomingCall.tsx` 与来电页 `ActiveCall.tsx` 显示它，九宫格与 `callerUid` 仍用 caller。
  新增 engine `callMachine.test.ts` 两条（带 inviter / 回落）、uikit `callView.test.ts` 两条；server 仓的 `call_fsm.json` 另加了两条向量用例，本仓 `callMachine.test.ts` 自动跑到。
  跑了 `tsc -b`、两个 Demo 的类型检查（自画 UI + 引 uikit）、engine `callMachine`（32 条）与 uikit 5 个文件（115 条）。

**同日已提交 `9f7c399`**：选人页列出全部成员（在通话里统一置灰「已在通话中」）、搜索框「放大镜 + 输入框」一行（`iconShapes.tsx` 的 `magnifyingglass`，Android 同一份路径）。

### 当时的「下一步」

0. **§A 发布被拒收场：用故障注入上真端走一遍**（先 `FAULT_INJECTION=1 ./scripts/dev.sh`）：通话接通后 `curl -X POST $B/v1/dev/faults -d '{"action":"reject","uid":"<本端uid>","frame_type":"room.publish","code":1302}'`，再开一次麦 / 摄像头 → 本端收场、结束原因 error、对端收到挂断。过了把 CLIENT_PARITY 那一行 🟡 转 ✅。代码已提交，真机验收后续再做（2026-09-16 用户定）。
1. 用户自测（服务端先重启）：发起人挂断后，被叫在选人页能选到他并邀请；他那边来电页不出现自己的格子。自测过了跑 `./scripts/test.sh` 再提交。
2. API 命名对齐遗留：`engine.ts`（582 行）与 `media/webrtcAdapter.ts`（529 行）体量 WARN，再往里加东西前先拆；
   `destroy()` 之后哪些方法抛 2005 没和 iOS / Android 逐条对表；`openMicrophone` / `openCamera` 等四个开关只有 engine 层单测、没在真浏览器点过。

---

## 2026-09-15 深夜（选人页优化前）：四端 API 命名对齐（已提交 `90d0668`）

2026-09-15 夜从 current_task.md 移出，原文照录。

### 当时的「当前焦点」

**2026-09-15：四端 API 命名核对——本仓只改 im-rtc-web（协议文档 / CLIENT_PARITY / 另外三端由别的会话并行改）。
直接在 main 上改，未 commit / push。`./scripts/test.sh` 全绿（14 步；engine 385 / uikit 180 / demo-react 17）。**

- **`callCancelled` 事件载荷 `{by}` → `{uid}`**：只改公开事件表这一层——线路字段与一致性向量
  （`call_fsm.json`）钉的仍是 `by`，`callRecv.ts` 内部回调参数不能跟着改。翻译点在
  `engineBus.ts` 的 `emitMachine`（新增一条 `callCancelled` 专属的 `by→uid` 改名，其余事件走
  照常的 snake→camel）。下游改了 `events.ts` 的类型与 `subscribeEngine.ts` 的 `e.by`→`e.uid`。
- **新增 `CallEngine.destroy(): void`**：终态销毁 = `logout()` + `EngineBus.clear()`（新增）。
  **可重复调用**（幂等，不重复 logout）。之后再调「发起动作」的方法统一**抛 `2005 invalid_state`**
  （不是静默空操作——事件订阅已清空，静默的话宿主的 `hangup()` 之类调用会石沉大海，没有任何
  信号说明原因）；新增私有 `act()`（`call/joinCall/accept/reject/cancel/hangup/inviteMore/joinRoom/
  leaveRoom` 共用的 dispatch 外壳，顺带把销毁检查收在一处）与 `mediaApi()` 里的检查（覆盖
  `probeMicrophone/probeCamera/publishMicrophone/publishCamera/setMuted/setRemoteLayer` 及新增的
  四个 open/close 方法）；`login()` / `startLocalPreview()` 单独各挂一行检查。**例外**：`logout()` /
  `forceEnd()` / `on()` / `uid` / `state` / 读或清理类方法（`attachView` 传 `null`、`localTrack`、
  `stopLocalPreview`、`updateToken`）**不受影响**，销毁后调用仍安全——它们本来就该在任意时刻可
  无脑调用（尤其 `forceEnd()`，红键看门狗与 `logout()` 都靠它"绝不抛"这条契约）。
- **新增按类型的媒体开关**（`openMicrophone` / `closeMicrophone` / `openCamera` / `closeCamera`，
  与腾讯 TUICallEngine 同名）：open = 该类型还没发布就发布（摄像头复用预览，走 `publishCamera`
  现有逻辑），已发布就 `setMuted(cid, false)`；close = 对已发布的那条 `setMuted(cid, true)`
  （不 unpublish），没发布过是空操作。**「发没发布过」问的是媒体适配器自己的账**
  （`MediaAdapter.publishedMicrophoneCid()` / `publishedCameraCid()`，新增到接口，`WebRTCAdapter`
  实现——麦克风新增 `micCid` 字段跟 `acquire()` 一起记账，摄像头复用已有的 `preview`/
  `cameraPublished`），**不在门面 `engine.ts` 另开一份影子记账**：协调会话中途指出 iOS 在等价
  实现上踩过这个坑——门面自己记账的话，宿主先直接调 `publishMicrophone()` 发布过、再调
  `openMicrophone()` 会被误判成"没发布"而重复发布（pub PC 上多挂一条 sender）。`micCid` 的清账
  跟着 `WebRTCAdapter.close()` 走（`bridge.reset()`/`bridge.close()` 已经在通话结束/离房/logout
  时调它，不需要另外接线）。`publishMicrophone`/`publishCamera`/`setMuted(cid)` 保留作高级接口；
  uikit 内部未改用新方法（未扩大改动范围，符合任务边界）。
- **uikit 改名对齐 iOS/Android**：`CallProvider` 的 prop `inviteProvider` → `inviteMemberProvider`，
  `onInviteRequest` → `presentInvitePicker`；类型 `InviteProvider` → `InviteMemberProvider`，
  `OnInviteRequest` → `PresentInvitePicker`（`invite/types.ts` + `index.ts` 导出同步）。
  `InviteConfig`（`CallProvider.tsx` 内部 context 形状）的字段名 `provider`/`onRequest` **未改**
  ——那是内部实现细节，不是公开 prop。`ProfileProvider` 按规格**不改名**。Demo 侧
  `fakeInviteProvider.ts` → `fakeInviteMemberProvider.ts`（连带改了 `App.tsx` 的 import 与
  prop 名）——这处改名不在规格明文要求里，是 sed 全局替换 `InviteProvider`→`InviteMemberProvider`
  时把文件内的同名标识符一起带过去了，顺手把文件也重命名以保持一致，未额外核实是否有隐藏用户
  依赖这个内部命名（Demo 站点范围内应该没有）。
  **不留兼容别名**：宿主暂无人用这些 API，四个改名点全仓找不到旧名残留。
- **`CallEndReason` / `CallEndReasonValue`**：确认已经从 `@im-rtc/call-engine` 包入口
  （`src/index.ts`）导出，不用补。
- 新增测试：engine `test/mediaToggle.test.ts`（13 条，含"先 publishMicrophone/publishCamera
  再 open*"两条专门钉住"不能另开影子账"的回归用例）、`test/publishedCid.test.ts`（3 条，
  `WebRTCAdapter.publishedMicrophoneCid/publishedCameraCid` 的直接单测）、`test/engineBus.test.ts`
  （3 条，`callCancelled` 字段翻译 + `clear()`）；四个既有的 `MediaAdapter` 测试假实现
  （`test/nullMedia.ts` 改成真状态、`engineEvents.test.ts`/`updateToken.test.ts`/`engineIce.test.ts`
  的本地假类）补了新接口方法的桩，否则类型上不再满足 `MediaAdapter`（这几个测试文件不在
  `tsc -b` 的 `include` 里，不补也不会被门禁挡住，但会是隐藏的类型错误，顺手修了）。

## 下一步

- **没做 / 已知限制**：
  - `demo-react/src/fakeInviteMemberProvider.ts` 的改名是 sed 连带出来的，不是规格明文要求；
    功能未变，但如果协调会话认为 Demo 内部命名不该跟着动，可以单独 revert 这一个文件名。
  - `engine.ts`（582 行）与 `media/webrtcAdapter.ts`（529 行）体量门禁给了 WARN（阈值 480，
    硬顶 600）——都还没超标，但这次分别加了 ~100 行和 ~20 行，下次再往这两个文件加东西前
    应该先看一眼要不要拆，别等触顶才拆。
  - `destroy()` 之后哪些方法"抛 2005"、哪些"始终安全"是我按本仓既有风格自己权衡的（规格给的
    是"选一种，写进注释"），没有和 iOS/Android 的等价实现逐条对表——如果协调会话已经定了
    另外三端的选择，这条可能要跟着改成一致的策略。
  - open/close 媒体开关目前只在 `call-engine` 层加了测试；uikit 按规格没有改用新方法，所以
    uikit 侧没有新增覆盖这四个方法的测试（符合"避免扩大改动"的要求，但也意味着 uikit 集成路径
    上这四个方法目前只有 engine 层的保证）。
  - 浏览器没有手动验证：全部通过 `./scripts/test.sh`（jsdom + node）过的，没有起 `dev.sh` 在真实
    浏览器里点一遍 `openMicrophone`/`openCamera` 或验证销毁后的 UI 表现。
- 本仓不改 `../im-rtc-server` 的 `/guide` 文档、`CLIENT_PARITY.md`、`RTC_PROTOCOL.md`——按任务边界
  留给主会话处理；协议字段（`callCancelled` 的线路字段名）本身没有变化，只是 SDK 公开事件层的
  命名，理论上不需要协议文档跟着改，但如果协议文档里也写了 `EngineEvents` 层的示例代码，可能要
  一并核对。

---

## 2026-09-15（API 命名对齐前）：宿主对接 M1 → M2 → M8 + 1409 缺口修复

被「四端 API 命名核对」（`callCancelled` 事件字段、`destroy()`、按类型媒体开关、uikit 邀请回调改名）
挤下 `current_task.md` 前的原文：

**2026-09-15：宿主对接 M1 → M2 → M8 做完之后，补了一个 Kit 缺口——邀请鉴权回调 1409 在 Web
上原先有两个洞（见下一条）。`./scripts/test.sh` 全绿（14 步，engine 366 / uikit 180 / demo-react 17）。未提交。**

- **1409 缺口修复**：查实 `useCallActions.inviteMore` 头上那段 `try/catch` 是**死代码**——
  `FrameLoop.sendFrame` 从不把服务端拒绝转成异常，`inviteMore()` 也没有任何本地校验会
  `throw`，所以那段 catch（含「对方暂时无法被邀请」的提示与占位格回收）从来没被真正触发过；
  1202 / 1407 同理，`subscribeEngine.ts` 原先接的 `error` 事件只出提示、**没有**收占位格
  （同一处死代码留下的假象）。改法：`subscribeEngine.ts` 新增 `inviteRevoked`（1202/1407/1409
  共用，调 `participants.ts` 的 `revokeLastInvited`）与 `inviteRejectedByHost`（1409 专用，
  按 `state.phase==='connecting'&&roomId===''` 识别「主动加入还没成」并跳过，避免跟
  `joinCallFailed` 的「无法加入该通话」撞在一起冒两条提示）；`viewTypes.ts` 新增
  `lastInvited`（每次 `inviteMore` 整批替换，只收最近这一批，不误伤上一轮还在响铃的人）与
  `endHint`（初始 `call()` 被拒时 `phase` 还是 `outgoing`，`callEnd` 紧跟着到，`CallOverlay`
  换成 `CallEnded` 之后 `hint` 没人读了，单独记一份挂在 `CallEnded.tsx`，做法同 `joinDeniedText`）；
  `useCallActions.inviteMore` 的 catch 精简成纯防御性日志。
  **已知限制（本次没修，不在任务范围内）**：`call.join` 本身也可能被 1202/1407 拒（见
  `joinDeniedTextFor` 的注释），那种情况下 `subscribeEngine` 的全局 `error` 监听器与
  `useCallActions.joinCall` 的临时监听器会同时收到同一条，可能双出「无法加入该通话」+
  「通话已满员」——这是 1409 之外的同类问题，没有被这次改动引入，也没有一并修。

- **M1（engine）**：`call.invite` / `call.incoming` / `call.connected` 加 `chat_group_id`（三处）与
  `call.connected` 加 `caller` / `user_data`（`signaling/frames.call.ts`）；`call()` 签名改成
  `call(calleeIds, mediaType, options?: boolean | CallOptions)`（`CallOptions = {isGroup?, chatGroupId?,
  userData?, timeoutSec?}`，传布尔等同旧 `isGroup`）；新增 `joinCall(callId)`（状态机那半——
  `callMachine.ts` 的 `join_call` / `joinOngoingCall`、`engineMachine.ts` 的 `CALL_ACTS`、
  `frameLoop.ts` 的 rollback 表——**M1 开工前就已经在，这次只是把门面方法补上**）；`ErrorCode.inviteDenied
  = 1409`；本地校验 `chatGroupId`（>64 字节或含空白）/ `userData`（>4096 字节），与「名单里有自己」同一个
  出口（`engine.ts` 的 `rejectsBadCallOptions`，纯校验挪进新模块 `callOptions.ts` 的
  `violatesCallOptionLimits`——engine.ts 是体量红线卡得最紧的文件，能抽出去的纯函数不留在里面）。
  `CallContext` 新增 `chatGroupId` / `userData` 两个字段，
  只当 `call.connected` 没带值时的回落（`callRecv.ts` 的 `handleConnected`）。
- **M2（uikit）**：新模块 `src/invite/`（`types.ts` 的 `InviteContext` / `InviteCandidate`（扩
  `avatarUrl`/`subtitle`/`selectable`/`unselectableReason`）/ `InviteProvider` / `OnInviteRequest` /
  `CanInvite`，`inviteContext.ts` 的 `buildInviteContext`）；`CallProvider` 新 props `inviteProvider` /
  `onInviteRequest` / `canInvite` / `allowManualUidInput`（默认 `false`），经 `useCall().invite` 暴露；
  `InvitePicker.tsx` 整个重写：300ms 防抖 + 请求序号作废旧结果、滚到底翻页、加载中/失败(重试)/
  超时(10s) 三态、已在通话中不可选、`selectable:false` 置灰带 `unselectableReason`、按 `slotsLeft`
  限选；`ActiveCall.tsx` 的 `handleInvite` 做取名单优先级（`onInviteRequest` 接管 > 弹
  `InvitePicker`）；`CallHeader.tsx` 的按钮显隐叠加 `invite.canInvite(ctx)`（不叠加 chatGroupId 判断）。
  `useCall().joinCall(callId)`：`joinCallRequested` 直接把 `CallViewState.phase` 打成 `connecting`
  （复用既有的「接通中…」文案，不经来电页）；失败时 `joinCallFailed` **自己**把阶段收到 `ended`
  并把 `CallEnded` 要显示的文案换成「无法加入该通话」（`state/callView.ts` 的 `joinDeniedTextFor`）——
  不依赖真 engine 是否会紧跟着抛一条 `callEnd`，两条路径都收得住（`useCallActions.joinCall` 的注释里
  记着为什么不能用 `try/catch` 拿失败：`FrameLoop.sendFrame` 从不把服务端拒绝转成异常）。
  初始 `call()` / 通话中 `inviteMore` 被 1409 拒时提示「对方暂时无法被邀请」（经 `subscribeEngine`
  的 `error` 事件，不经 `inviteMore` 的 catch——那条路死代码，见上一条「1409 缺口修复」）。
  静态 `inviteCandidates` 保持兼容（取名单优先级最低档）。
- **Demo**：`demo-react/src/fakeInviteProvider.ts`——真实 `DEMO_CONTACTS` 排前面 + 40 个假成员凑分页
  （一页 12 条），搜索词 `fail` 立即 reject、`slow` 永远不 resolve（验证 uikit 的 10 秒超时）；`App.tsx`
  把 `inviteCandidates={DEMO_CONTACTS}` 换成 `inviteProvider={fakeInviteProvider}`；`Dialer.tsx` 群呼带
  `chatGroupId: 'demo-group'`，新增「按 call_id 加入」一行（`useCall().joinCall`）。`demo/`（自画 UI）
  没碰通话 API，`tsc --noEmit -p demo` 照样过。
- 新增测试：engine `test/callOptions.test.ts`（`call()` 的 options 校验、`joinCall` 正常与被拒两条路径）+
  `test/callMachine.test.ts` 补的回落用例（`call.connected` 不带群号时回落到 `call()` 选项 / `call.incoming`
  记的那份）；uikit `test/hostIntegration.test.tsx`（`joinCall` 三条、`inviteProvider` 六条含防抖/
  分页/失败/超时、`onInviteRequest` 三条、`canInvite` 两条，加了一条 1409 时不重复冒「对方暂时无法被邀请」
  的断言）；`interactions.test.tsx` 改了一条（`allowManualUidInput` 默认关，原「宿主没给名单：输入 uid
  也能邀请」拆成两条）；1409 缺口修复新增（uikit 173 → 180）：`宿主邀请鉴权回调拒绝（1409）` 整个
  describe 块三条（初始呼叫被拒、通话中加人被拒、跨批次不误伤）+ 改写「加人被拒：占位格要收回来」
  （原来靠 `FakeEngine.inviteMoreError` 抛异常，现改走真实的 `engine.emit('error', …)`）+ 新增
  「inviteMore 抛出意料之外的异常：不崩溃」（防御性 catch 的兜底测试）。

**下一步（当时记的，未必仍然成立，看 git log 与新的 current_task.md）**：
- `joinDeniedTextFor` 不按错误码细分文案；`InvitePicker` 的 uid 输入框判据是 `items.length===0`
  不是过滤后 `shown.length===0`；provider 失败/超时非 Error 值的丢失未验；`joinCall` 双开标签页
  与 `fail`/`slow` 搜索词没有在真实 5179 demo-react 上点过；server 端 `call.join` 与邀请鉴权回调
  本仓没有跟着联调过真服务端。
- 协议文档 `RTC_PROTOCOL.md` §4.1 错误分支表没提 1409；`HOST_INTEGRATION_DESIGN.md` §3.4 没写清楚
  provider 超时后回调迟到 resolve 怎么处理（本仓按 seq 作废不回填）——这条约定值得回写进设计文档。
- 里程碑完成后应同步 server `docs/design/RTC_CALL_DESIGN.md` §10，本次没有改（任务范围只在 im-rtc-web）。


## 2026-09-15（M1 开工前）：强制收场（forceEnd）与红键看门狗

被 M1/M2/M8（宿主对接：`chat_group_id` / `joinCall` / provider 选人页）挤下 `current_task.md` 前的原文：

**红键等不到结束事件时引擎也收场（`forceEnd`）+ uikit 补红键看门狗（Web 原先没有）。已提交 `dd5e4c0`，
09-15 与 iOS frank、Android alice 联测验过。两个小账随后单独一笔提交（单测覆盖，真机未验），
`./scripts/test.sh` 全绿（14 步，engine 345 / uikit 156 / demo-react 17）。**
- 小账已修：① 强制收场时长从本端 `onCallBegin` 那一刻算（`EngineContext.callStartedAtMs`，`reduceEngine`
  入口统一打点、通话回 idle 清零），不再用整通 `connected_at_ms`；
  ② 拨出中没 call_id 时按取消不发帧、记 `CallContext.cancelPending`，`call.invite.ok` 一回来立刻补发
  `call.cancel`（不再换回 1401）。
起因 09-13 14:53~14:58 iOS frank：接听后 room.join 晚 28.6 秒才上线路，其间按红键，call.hangup 一帧没到
服务端；看门狗只收了界面，引擎留在通话与房间里，其余端一直看得见他。
iOS 已落同形状（`../im-rtc-ios/current_task.md`），形状见 server `CLIENT_PARITY.md` 的 `[^forceend]`。
上一件（对端重开摄像头闪一下）已提交 `e447276`、21:11 验过。

- engine `CallEngine.forceEnd(): void`（同步、不抛）→ `FrameLoop.forceEnd`：纯函数 `state/forceEnd.ts`
  （`forceEnd` / `endFrames`）挑帧——通话中 hangup、响铃 reject、拨出 cancel、accepting reject+hangup、
  会议 room.leave；帧走 `Connection.fire`（不等应答、应答配对后丢掉、未连接只记日志）**不排在在途请求
  后面**；本地收场与发帧在同一次同步调用里（先发帧、再落状态/关媒体/抛事件），所以不需要 iOS 那种
  call_id 比对。
- 迟到帧：`roomRecv.ts` idle 下 `room.join.ok` 补发 `room.leave`、其余丢弃；`callRecv.ts` idle 下
  `call.invite.ok` 补发 `call.cancel`、`call.connected` 补发 `call.hangup`（拨出中没 call_id 的补救）；
  `frameLoop` 房间 idle 时丢迟到的候选 / SDP。
- `请求往返慢`（≥ 2000ms，`type` / `elapsed_ms` / `failed`）。没做卡顿探针（iOS 独有）。
- uikit：`redButtonWatchdog.ts`（`RedButtonWatchdog` 注入调度器、`endActionFor`、`endWatchdogReason`）；
  `useCallActions` 的 `end` 与 `reject` 都武装，phase 到 idle/ended 撤；到点 → `callEnd`（本地收场）+
  `engine.forceEnd()`；`CallProvider` 新 prop `endWatchdogMs`（默认 3000）；视图状态 idle 下 `callEnd` 忽略。
  日志 `[uikit] 按下红键` / `[uikit] 红按钮本地收场：没等到结束事件`。
- 用例：engine `test/forceEnd.test.ts`、`test/forceEndEngine.test.ts`、`test/connectionFire.test.ts`；
  uikit `test/redButtonWatchdog.test.ts`、`test/endWatchdog.test.tsx`。`test/engineIce.test.ts` 的
  `joinRoom` 原先靠「idle 下凭空认领 call.connected / join.ok」进房，改成先 `call.incoming` 再接通、
  应答真的那条 join；两条候选用例先进房。

**当时的下一步（浏览器验收，部分已完成）**：
- ~~浏览器验收~~（09-15 demo-react 5179 已验，服务端 `FAULT_INJECTION=1`）：② 故障注入拒掉 bob 的
  hangup 10:06:09.548 → 10:06:12.549 `强制收场` 补发被受理，`callEnd` 只抛一次；③ 延迟 bob 的
  `call.invite` 8 秒、其间按取消：10:09:21 本地收场（没 call_id、没发帧）→ 10:09:24.917 invite 落地 →
  补发 `call.cancel`，alice 横幅只露 13ms；`请求往返慢 elapsed_ms=8003` 也记下了。
  还没验：① 正常挂断路径（iOS / Android 已验，Web 走同一段 `end`，风险低）；断网后按红键（结束帧发不出去、
  只本地收场）。
- 首帧闸门 21:11 实测：`wait_ms` 232–910、`judged_by` 全是 `receive_time`、两次 `skipped=1`；以后再报闪
  先看这三个字段，常撞 2 秒兜底就查后台标签页 / 对端迟迟不出关键帧。
- 静默失败点清单（P0×3 / P1×7 / P2×7）：`../im-rtc-server/docs/ops/silent-failure/web.md`，逐条状态只在
  那里。未修头两条：§A 发布 / 订阅被拒没有收场路径（四端同源）、呼出阶段按静音只改 UI 对方仍听得见。
- 跨端老批次（含本端「挂断后再邀请回来看得到画面」）清单见 `../im-rtc-server/current_task.md`「跨端待验」。
- `getUserMedia` 那类失败仍可能静默：日志回传够不到浏览器 console。
- `CLIENT_PARITY.md` 真机验完再改。


## 2026-09-08 之前的「当前焦点」（resumeRoom 那一刀挤下来的）

**`/code-review high` 的 13 条一次修完（2026-09-08）**，在 worktree `../wt-web-review`
（分支 `fix/review-11`）上做，`./scripts/test.sh` 十三步全绿。**没上浏览器，没真机。**

其中 11 条是本仓自审出来的，另外 2 条是 iOS 评审在 `IMFrameLoop` 上发现、
本仓一模一样也有的（`leave_failed` 与 `accept/join` 不回滚）。

| # | 症状 | 改在哪 | 三端情况 |
|---|---|---|---|
| 1 | 坏应答帧解码抛错 → `request()` 永不落定，房间永停 `joining`，宿主一条错都收不到 | `connection.decodeData` 解不动就按原始 data 放行 | iOS/Android 本来就有兜底，**只有本仓漏了** |
| 2 | 没连接时帧被静默丢弃、状态机卡死（未登录就 `call()` → 永停 `inviting`） | `frameLoop.sendFrame` 回 `2007` 并走 `rollback` | **iOS 同病**；Android 早就是对的，照抄它 |
| 3 | `login()` 不关旧连接 → 假 `kickedOut`，旧 `ResumeDeadline` 75s 后杀掉**新**会话 | `login()` 已连接就拒，失败收摊 | iOS 早修过并留了注释，本仓是没跟上的那个 |
| 4 | `resumed=false` 静默清房、一个事件都不抛 → 会议界面永远显示「会议中」，媒体面不归零 | `engineMachine.dropLostSession` 没 call 时补 `onRoomLeft` | **三端同源，iOS/Android 都没修** |
| 5 | `room.leave` 被拒无回滚 → 房间永停 `leaving`，**摄像头指示灯一直亮** | 新增 `leave_failed` | iOS 同病；Android 有 |
| 6 | `call.accept`/`call.join` 被拒无回滚 → 滞留 `accepting`，来电屏没有出口 | `rollback` 表加这两个 type | iOS 同病；Android 有 |
| 7 | `ViewRegistry.removeTrack` 从未接线 → 退订的轨道留在 `MediaStream` 上 | `MediaBridge.syncRemoteTracks` 双向对账 | Android 干净；iOS 是另一种形态（重复 sink） |
| 8 | `joinMeeting` 先置界面态，`joinRoom` 同步抛 1004 后卡死、拨号面板全禁 | 只包 `joinRoom` 那一句，失败 `dismiss` 并重抛 | 本仓独有（那两端 `joinRoom` 不校验也不抛） |
| 9 | 麦克风推流失败成 unhandled rejection，**声音画面一起丢**且零提示 | `publishFor` 接住麦克风那半，出提示后继续推摄像头 | iOS 是弱化版（`try?` 吞掉，同样没提示） |
| 10 | 九宫格截断的人**连声音一起没了**（会议第 9 人起） | `GridStage` 给 offscreen 的人补 `RemoteAudioSink` | 本仓独有（那两端远端音频不绑视图） |
| 11 | 小窗跟着主讲人换 → 每 300ms 重挂两个人的 `srcObject`，音频断续 | 小窗固定画 `participants[0]` | 本仓独有（那两端浮窗不挑主讲人） |
| 12 | `tokenExpiry` 延时超 2^31 溢出 → 长有效期票每次握手都误报一次 | 分段续排 | 本仓独有（Int64 / Long 没这个坎） |
| 13 | 根 `npm test` 把 uikit 用例塞进 node 环境跑，红 63 条 | 拆成 `test:engine` + `test:uikit` | 不适用 |

**新增用例 21 条**（`failureRecovery.test.ts` 7 + engineMachine 6 + viewRegistry 3 +
tokenExpiry 2 + meeting 2 + interactions 2）。第 10、11 条**注入旧实现验过载重**——
换回原样后那两条立刻红。

**没做**：iOS 与 Android 的第 4 条（三端同源那个）**没动那两个仓**，
`IMRoomMachine.resume` 两处都要补同样的 `onRoomLeft`；iOS 的第 2/5/6 条同理。
`CLIENT_PARITY.md` 也没更新。


## 2026-09-09 之前的「当前焦点」

**补上跨端 review 的最后一条：`resumeRoom` 无条件推 joined（2026-09-08）**，
`./scripts/test.sh` 十三步全绿（engine 288 / uikit 105）。
分支 `fix/parity-recovery-0908`（worktree `../wt-web-review-fixes`）。

那一轮 review 在 iOS/Android 上抓到三条「某一帧被拒之后没人收场」，本仓的
`9ddc6d2`（13 条那一刀）已经顺手带掉了其中两条——`room.leave → leave_failed`、
`call.accept` / `call.join → call_failed`，改法与另外两端一致。**只剩这一条。**

### 症状

`disconnected` 会把**任何**非 idle 状态推进 `reconnecting`，`joining` 也在内。
而从 `joining` 断的那一种，`room.join` 当时还在飞：服务端从没受理过我们，
恢复的只是那条 WS 会话，**不是房间成员关系**。原先 `resumeRoom` 无条件宣布 `joined`：

- 本端以为自己在房里 → 之后每一帧都换回 1201/1203；
- 重新 join 又因为「不在 idle」被本地拒成 2005；
- 一个哑掉的死局，**日志里一条报错都没有**。

### 本端踩得比另外两端更稳

`handleClose` 是**同步**调 `onDisconnected` 的，而 `dispatch` 头一行就同步 reduce；
`rejectAll` 触发的 `join_failed` 只能等微任务。所以 `disconnected` **每次都赢**，
那条本该兜住它的 `join_failed` 必定变成空操作（它 guard 在 `joining` 上，状态早被推走了）。
**iOS 那边是竞态、这里是稳定复现**——所以判据不能靠时序。

### 改法（四端同一份）

`RoomContext` 加 `didJoin`，**只由 `room.join.ok` 置位**（`roomRecv.ts` 的 `handleJoinOk`）。
`resumeRoom` 据它分辨来路：真进过房才回 `joined`，否则走 `rejoin()`——
**重发一次 `room.join`**（房号、房票、`auto_subscribe` 都还在手上，攒下的意图照旧留着重放）。
连房号都没有（join 的帧还没产出就断了）就干净地回 idle，不发帧。

**向量没动**：两条 reconnect 向量的初始态都是 `room: joined`，`didJoin` 影响不到它们。
向量跑法里补了一句种子（初始就在房里的把 `didJoin` 一起置上）——
**是种子不完整，不是实现变了**。

**新增 7 条用例**（`test/roomResume.test.ts`）。把 `resumeRoom` 里那行 `didJoin` 判断
删掉注回旧逻辑，其中 4 条立刻红（重发、意图留存、auto_subscribe、无房号回 idle），
另外 3 条是护栏（从 joined 恢复、resumed=false、join.ok 置位），本就不该被这个注入影响。

# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：只记当前状态，**就地覆盖、不追加**。历史见 `git log`。
> 工程规范见 [CONVENTIONS.md](CONVENTIONS.md)；方案与分期见 `im-rtc-server` 的
> `docs/design/RTC_CALL_DESIGN.md` §10；界面以草图 §06 为准。

## 当前焦点

**P2 全部落地（2026-09-03）：engine + uikit + 两个 Demo 站点，浏览器三方实测通过。**

| 包 | 内容 | 怎么验的 |
|---|---|---|
| `@im-rtc/call-engine` | 协议层、WS 客户端、通话/房间/总状态机、WebRTC 适配器 | 177 个用例，含 50 条四仓共用向量 |
| `@im-rtc/call-uikit-react` | 来电浮层 / 1v1 / 九宫格 / 小窗 / 控制条 | 39 个用例（纯逻辑 + jsdom） |
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

**三人会议实测又抓到四个（2026-09-03，全部已修 + 回归用例）**：
5. **会议房里点挂断毫无反应，三端都退不出去**。红按钮无条件走 `hangup`，
   而**会议房里根本没有 call**，通话机把它本地拒成 2005——宿主只看到一条没头没尾的 error。
   会议的结束动作是 `leaveRoom`；视图模型为此多了 `isMeeting`，另外补订阅了
   `roomLeft` / `roomClosed`（会议没有 `callEnd`，漏了就等于没有结束出口）。
6. **4401 会无限重连**。重连带的是**同一枚 token**，服务端重启换了签名密钥之后，
   没关的标签页重试到第 19 次还在敲，日志里全是 `token_invalid`。
   按协议 §1.5 加了「连续 3 次就放弃并抛 `onKickedOut`」。
   放弃必须用**闩**（`Reconnector.stop()`）：`connect()` 被拒那条是微任务，
   排在 close 之后，只取消定时器的话它会把重连又排回来。
7. **一次断线排两次重连**，退避档一次涨两级（日志里 `attempt=14` 紧跟 `attempt=15`）——
   失败会从 close 事件与 `connect()` 被拒两条路走到 `schedule()`。
8. **`disconnected` 每次抛两遍**，其中一遍空载荷；「鉴权到顶」还借用了
   `ws_closed_4403`，于是混进一条**假的 4403**。宿主想数重连次数就数不对。
   现在关闭码由连接层独占上报，状态机那份只驱动状态迁移。

**接着做「Demo 该演示换 token」时又抓到两个（同日）**：
9. **`CallEngine` 根本没暴露 `updateToken`**。`Connection` 上有，门面没有——
   于是协议 §1.5 要求宿主做的那件事（`4401` → 换新票重连），Web 端**做不到**。
   补上公开方法（push 不 pull：不做「token provider 回调」那种让 engine 自己去要票的设计），
   并写进设计文档 §7.5 的主动方法表（四端同名）。
10. **自动重连的握手结果没人接**。`Connection` 会抛 `onConnected`，但
   `connectionFactory` 压根没把它接出去——门面只在 `login()` 里手工喂了一次 hello.ok。
   后果不是「少一个事件」，而是**重连之后状态机不知道自己重连了**：
   `resumed=false` 时房间不归零（之后每帧都发向一个已消失的房间）、
   `resumed=true` 时攒下的意图不重放，宿主也永远收不到第二次 `connected`。
   实测症状：服务端重启后换票重连其实成功了，界面却一直停在「重连中」。
   **iOS 的 `IMConnectionEvents` 连 `onConnected` 都还没有**，已一并补上并写明理由，
   免得 iOS 门面落地时再踩一遍。

同时补上：**九宫格/会议里的静音角标**（`hasAudio` → 🔇，本端读开关、远端读
`userAudioAvailable`），以及 engine 的一条诊断日志「动作被状态机本地拒绝」——
带上 op 与当时的两个状态。第 5 条那次排查全卡在「十几条一模一样的 2005」上，
要读代码才能推出点的是哪个按钮。

**2026-09-05 真机 + 三标签页联调修掉的（本仓这一侧）**：

1. **刷新页面又回到登录界面** —— 不是登录态没存住，是**页面把自己踢了**。
   自动重登的闩是 state，而 React 18 StrictMode 在开发模式下把 effect 跑两遍，
   `restoring` 要等 promise 落地才变 false，第二遍进来时还是 true → 同一个页面
   登录两次 → 同 uid 同 device_id → 服务端按协议踢掉先来的那条 → `onDead` →
   退回登录页。闩改成 ref，第一遍就同步置位。（服务端日志里一次刷新有两条「Demo 免密登录」。）
2. **开第二个标签页会把第一个顶下线** —— 记住的登录参数原先存在 localStorage，
   而它**整站共用一份**，新标签页一加载就拿着上一个用户名自动登录。
   改存 sessionStorage：每标签页一份、刷新仍在，正好是这里要的语义。
   （服务端地址与用户名输入框的记忆仍走 localStorage——那是输入便利，不触发登录。）
3. **呼叫名单里含自己被就地拒掉之后，界面卡在「正在呼叫…」** ——
   只抛了一条 error，界面不知道该退回哪儿，点挂断只会收到一串 2005。
   现在补抛 `callEnd{reason:error}`，与「服务端拒了 invite」走同一个出口。

**新增：采集画质档位**（`media/videoProfile.ts`，360p / 720p / 1080p，默认 720p）。
`EngineOptions.videoProfile` 或自己构造 `WebRTCAdapter(source, profile)`。
除了 `getUserMedia` 约束，还会给上行 sender 压 `maxBitrate`——不压的话浏览器会飙到
远高于服务端 simulcast h 层预算的码率，`bwe.go` 的降层判断就是按一个错的数字做的。

**会议房这一轮实测通过**（两个标签页：新建 → 加入 → 双向画面 → 一个人离开另一个还在 →
最后一个离开房间即销毁）。过程中抓到一个**画质档位落地时自己引入的回归**：
合成媒体源用 `constraints.video === true` 判断要不要视频，而档位落地后传的是约束对象，
于是**会议房里所有人都是头像，一行错都没有**——`acquire` 抛的 `deviceNotFound`
被调用方 `void` 掉了。判据改成「要不要」，`publishFor` 也补上了摄像头失败的日志
（摄像头挂了不该连累麦克风，但必须留下痕迹）。

**2026-09-05 第二轮复测修掉的**：

1. **来电被对方取消时，来电浮层当场变成通话页**（静音 / 关摄像头 / 小窗 / 挂断
   那一排全出来了），停一两秒才消失。实测原话：「为何还弹出一个那个接通才有的界面」。
   两处一起改：**还在响铃的来电结束时直接回 idle**；结束态也不再落到
   `ActiveCall` 上，改成独立的 `CallEnded`——整屏就一句话。
   顺带补上了**结束原因的人话**（`format/endReason.ts`，与 iOS 逐字对齐）：
   原先无论拒接、忙线还是对方不在线，都只写「通话结束」。
2. **视频呼出时看不见自己**。本端预览挂的是「已发布的那条摄像头轨道」，
   而拨出中根本还没有房间、没有发布。补上 `startLocalPreview`（四端同名）：
   **采集与发布是两件事**，`publishCamera` 复用预览那条轨道，不会把摄像头开两次。
3. **群通话里某人拒接 / 没接之后，他的格子还挂着「（响铃中）」**——
   从主叫的角度看，拒接就跟什么都没发生一样。补订阅 `userReject` / `userNoResponse`。
4. **九宫格格子被拉伸**：格子恒为正方形了，且**行列跟着容器形状走**
   （窄窗口上下摞、宽窗口左右排）。规则见 `layout/grid.ts`，与 iOS 同一个算法。

**2026-09-05 第三轮复测**：**视频来电页补上摄像头开关**（拍板 §11-10 定稿：
不另设「以语音接听」按钮）。关掉再接听就是同一件事，而且状态看得见、还能再打开。
关着接听时 `publishFor` **连摄像头都不开**（不是「开了再静音」）：用户表示不出镜，
指示灯就不该亮。「推不推摄像头」由调用方明说，不在 `publishFor` 里读 state——
会议那条路 dispatch 完立刻就调它，闭包里的 state 还没提交。

**语音通话里不再给摄像头按钮**（拍板见服务端设计文档 §11 第 10 条）。
协议上没有「转视频」这回事，原先那个按钮点了确实出镜、对方确实看得见，
而本端预览的 cid 在这条路上压根没记进视图状态——**自己不知道自己已经出镜了**。
判据是 `media_type` 而不是「本端摄像头开没开」（`showsCameraButton`，与 iOS 同一条）。

通话控制条改成**圆内图标 + 圆下文案**（`ControlButton` + `Icon`），
与 iOS 的 `IMControlButton` 同一套视觉、文案逐字对齐。
原先是「56px 圆里塞一行汉字」，「关摄像头」四个字挤在直径 56 的圆里既看不清、
也和 iOS 对不上（实测反馈：「静音按钮都没有对应的图片」）。
图标是**内联 SVG**：不引图标库（uikit 是要发 npm 的包，少一个运行时依赖），
也不用 emoji（iOS 那边踩过——真机上渲染成方框问号）。来电浮层的拒接/接听同样换掉了。

## 下一步

**P3 —— iOS**（`../im-rtc-ios`）：协议层 + 三个状态机 + 信令已落地并对着真服务端验过，
剩下门面/回调表、媒体（要真机）、Kit、Demo。**注意：不启模拟器验证**，
只能靠单测 + 一致性向量兜底。

**本仓剩下的**
- 预警线（320 行 / 上限 400）上的三个文件：`signaling/connection.ts` 382、
  `state/roomMachine.ts` 339、`call-uikit-react/src/state/callView.ts` 328。
  **下一次动它们时先拆**。
  （`engine.ts` 这轮拆完了：`media/mediaPlane.ts` 收候选进出与远端轨道落地，
  `frameLoop.ts` 收「输入进状态机 → 发帧 → 应答回喂」这条核心循环连同状态机快照；
  门面剩 279 行，只管对宿主的那张 API 表。）
- Demo 还没演示的：**主动换设备**、双击放大某一格。
- 弱网表现没测过（Chrome 限速对 WebRTC 的 UDP 无效，得靠服务端的 `scripts/weaknet.sh`）。
- Safari 没测过（simulcast 与 H.264 行为与 Chrome 不同）。
- uikit 还没做：双击放大某一格（`focusedLayer` 已备好但没接界面）、屏幕共享（MVP 不做）。

## 已知坑 / 限制

- **发送侧的默认值陷阱（各端都会踩，已写进协议 §2.4）**：「省略即取默认值」只对**真的省略**
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
- **换 token 是宿主的事**（协议 §1.5：4401 = 换新票再来）。engine 只提供
  `updateToken(token)` 这个口子，**不做 token provider 回调**——那等于让 engine
  自己去宿主的账号体系要票。两个 Demo 都演示了这套处置，共用
  `demo/src/connectionGuard.ts`（框架无关，demo-react 用 `@demo/connection-guard` 别名引）：
  `disconnected(4401)` → 取新票 → `updateToken`；抛 `kickedOut` 就回登录态。
  **同一次断线只换一次票**（三次 4401 会触发三次换票，而拿回来的票是一样的）。
- **会议房空了就销毁**：最后一个人离开后房间即关（服务端日志「房间已空，已关闭」），
  所以旧房间号再「加入」会得到「房间不存在」。房间号留在输入框里是有用的
  （要发给另一个标签页），所以两个 Demo 都改成**「新建」与「加入」两个按钮**，
  不再由一个按钮按输入框空不空自己猜；REST 失败也把服务端的 `error` 文案带出来了。
- **发送侧带宽估计会把「码率低」误判成「链路窄」**（服务端侧已加拥塞证据闸）。
  本机回环上曾把所有人压到 l 层，原因只是合成视频源码率本来就低。

- **没有「以语音接听」按钮**，视频来电页上那个摄像头开关就是它（拍板 §11-10）。
  关着接听时连摄像头都不开——**不是「开了再静音」**。
  `publishFor(mediaType, withCamera)` 的第二个参数**必须由调用方传**：
  它在 effect 里被调用，闭包捕获的 state 未必是最新一次提交
  （`joinMeeting` 里 dispatch 完立刻就调它，那次 dispatch 还没提交）。
- **语音通话里没有摄像头按钮**（`showsCameraButton`，与 iOS 的
  `imShowsCameraButton(for:)` 同一条判据）。想做「通话中转视频」得先加协议帧
  （`call.upgrade_request` / `upgrade_accept|reject`）= 改五仓，
  见服务端设计文档 §11-10。
- **格子恒为正方形，行列跟容器形状走**（`gridDimensions(count, aspect)`）：
  让格子吃满整块区域（`1fr` × `1fr`）的话，窄窗口两个人就是两条细长条。
  这条规则四端共用一份，iOS 的 `imGridDimensions` 是同一个算法——**改一边要改两边**。
- **还在响铃的来电结束时不进 ended**：那一侧什么都还没做，结束画面没有意义，
  而 `ended` 原先落在 `ActiveCall` 上，会把通话页整个铺出来。
  主叫那一侧相反，必须停一下说明原因（`endReasonText`）。
- **画质是宿主策略，不是 RTC 服务端下发的**（与换 token 同一条边界，协议 §1.5）：
  `videoProfile` 由宿主给，宿主要「后台可控」就把它放进自己的配置接口。
  **改档位要同步服务端 `internal/sfu/bwe.go` 的 `bitrateHigh`**，两边对不上会让降层判断失准。
- **`packages/call-engine/src/` 里不能放 `*.test.ts`**：`tsc -b` 会把它算进 build，
  于是 `vitest` → `vite` 的类型被拉进来，撞上 `exactOptionalPropertyTypes` 直接报错
  （错误还指在 `node_modules/vite` 里，看不出跟自己有关）。测试一律放 `test/`。

## 关联工程 / 常用命令

- **各端能力对照表：`../im-rtc-server/docs/CLIENT_PARITY.md`**（逐端逐特性状态的**单一真相源**，✅ 只写在那里，本文件不重复）。

- 协议契约与一致性向量：`../im-rtc-server/docs/RTC_PROTOCOL.md` 与 `../im-rtc-server/docs/conformance/`。
  **只读引用，不得单方面加字段**；改协议 = 改五个仓 + 同步向量。
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


---

# 2026-09-08 搬入：上一轮（已完成）

## 上一轮

**会话恢复之后重新协商上行（2026-09-07）**。`restart_pub_ice` 只在房间 `joined` 时被接受，
而网一断信令也断、房间变 `reconnecting`，PC 却要 30 秒后才判 `failed`——那时动作被拒且
**不进 `BUFFERABLE_OPS`**，永远丢失。改法是在 `onConnected` 里等 `sys.hello.ok` 落地后，
`resumed===true` → `media.restartPubICE()` + dispatch（协议 §1.4 早有规定，只是没实现）。
**没有真机复验**——ICE 那条要真的拔网线才验得了。

---

## 2026-09-11 精简前全文（✅ 已完成项与冗长细节从 current_task.md 移出，原文照录）

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

**2026-09-11 晚：「来电页 + 进房前关摄像头停采集」第 6 步 + 延后项①（本仓），直接在 main 改，已提交，用户浏览器里验过。**
六步总表在 `../im-rtc-server/current_task.md` 的「另一条线」；第 2 步（来电页 + `bannerFirst` + 预览单飞）已提交 `caa268f`。

- **进房前关摄像头停采集**：engine 新增 `stopLocalPreview()`。adapter 等在起的那次落地再停；`previewIntent` 序号——
  等的期间又有人要预览就听后来的；`cameraClaimed`（正在发布 / 已发布）的不停。
  uikit：进房前关摄像头先清 `localCamera` 再停；关着摄像头接通时停掉残留的预览。
- **通话中关摄像头也停采集**（`syncCameraCapture`）：关 = `track.stop()`；开 = 重新 `getUserMedia` 再 `replaceTrack` 到同一个 sender。
  transceiver / msid / cid 不变，**不重新协商**。开关排队串行（`cameraToggle`），`close()` 之后才回来的认出代数不对自己收摊。
  重新采集被拒时错误原样抛给调用方，轨道留在停着的状态。

`./scripts/test.sh` 全绿（13 步）。

### 测之前记得

**vite dev server 要重起**——uikit 按 `dist/` 被 demo 消费，不重起还是旧的（有一轮就这么白测了）。


## 下一步

- **本仓的静默失败点清单**（P0×3 / P1×7 / P2×7，2026-09-09 扫描）见
  `../im-rtc-server/docs/ops/silent-failure/web.md`，跨端结论与修复顺序见同目录的
  `SILENT_FAILURE_AUDIT.md`。**逐条状态只在那里维护，别抄回本文件。**
  未修的头两条：§A 发布/订阅被拒没有收场路径（四端同源）、呼出阶段按静音只改 UI 对方仍听得见。

### 本轮优先

**先重起 vite。**

1. 本批（进房前 / 通话中关摄像头停采集、挂断图标消失）用户 2026-09-11 浏览器里验过。
2. **demo-react 设置卡片**（2026-09-11 合入 `5cc89ef`）用户 2026-09-11 验过：横幅开关、详细日志、改画质重登、刷新后设置保持。

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
- **SDK 版本号改 `packages/call-engine/src/version.ts`（`SDK_VERSION`）+ 两个 `package.json`**（2026-09-11 五端统一 1.0.0），握手发 `web/1.0.0`。
  demo-react 的设置存 **localStorage**（偏好，双开共用），登录态仍是 sessionStorage；它的 vitest 已进 test.sh，
  但**体量门禁与日志门禁都不扫 `demo-react/`**（老漏洞，未修）。
- 发送侧一律用 `newFrameData(FIELDS)` 起手（协议 §2.4 的默认值陷阱）。

## 关联工程 / 常用命令

- **各端能力对照表：`../im-rtc-server/docs/CLIENT_PARITY.md`**（✅ 只写在那里，本文件不重复）。
- 协议契约与一致性向量：`../im-rtc-server/docs/RTC_PROTOCOL.md` 与 `../im-rtc-server/docs/conformance/`，只读引用。
- 起服务端联调：`cd ../im-rtc-server && ./scripts/dev.sh`（控制面 :8787，媒体面 UDP 7881）。
- 常用命令：
  ```bash
  ./scripts/install-hooks.sh                       # 新 clone 跑一次
  ./scripts/test.sh                                # 唯一测试入口（14 步）
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
