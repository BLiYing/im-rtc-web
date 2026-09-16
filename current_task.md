# Current Task — im-rtc-web（TS engine + React uikit + Demo）

> **活快照**：就地覆盖、不追加。历史见 `git log` 与 [current_task.archive.md](current_task.archive.md)（新的在上，顶节「2026-09-16 夜（SDK 改名 / IMRTC_SDK 三档开关前）」）。
> 规范 [CONVENTIONS.md](CONVENTIONS.md) · 分期 server `docs/design/RTC_CALL_DESIGN.md` §10 ·
> 界面以设计稿 **v3.1** 为准：`../im-rtc-server/docs/design/sketches/RTC_CALL_UI_SPEC.html` / `RTC_CALL_UX_FLOWS.html`。
> ✅ 状态只写在 `../im-rtc-server/docs/CLIENT_PARITY.md`。

## 当前焦点

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

## 下一步

0. ~~发布后验公网包~~：2026-09-17 两个包已发 npm 1.0.0（用户在终端用通行密钥发的——`npm publish` 要 2FA，Claude 这边没 TTY 发不了），`pack-sdk.sh public` + 两个 Demo 按包类型检查 + vite build 都过；仓外空工程只装 uikit 也带上 engine。
2. 用户自测（服务端先重启）：发起人挂断后，被叫在选人页能选到他并邀请；他那边来电页不出现自己的格子。自测过了跑 `./scripts/test.sh` 再提交。
3. API 命名对齐遗留：`engine.ts`（582 行）与 `media/webrtcAdapter.ts`（529 行）体量 WARN，再往里加东西前先拆；
   `destroy()` 之后哪些方法抛 2005 没和 iOS / Android 逐条对表；`openMicrophone` / `openCamera` 等四个开关只有 engine 层单测、没在真浏览器点过。

## 已知坑 / 限制

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

## 关联工程 / 常用命令

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
