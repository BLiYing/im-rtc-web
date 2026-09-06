/**
 * 设计令牌 —— 设计稿《通话界面规范》§02–§04、§07 的落点。
 *
 * **所有色值、尺寸、时长集中在这里，组件里禁止再出现字面量**（与 iOS 的 `IMKitTheme`
 * 是同一张表，字段名逐条对应：`overlay ↔ overlayBackground`、`ctlIdle ↔ controlBackground`…）。
 * 四端同值，改一处就要改四处——所以每个值旁边写的是「它出现在哪」，不是「它长什么样」。
 *
 * 通话页**固定深色、不随宿主主题**：它几乎总是叠在视频画面上，浅色底会把画面衬得发灰。
 * 想换皮肤就整个替换这个对象——但样式不是本产品的卖点，别在这上面加抽象。
 */

/** callColors 是通话页的 11 个语义色（规范 §02）。 */
export const callColors = {
  /** 全屏遮罩底。Web 用 .96 透出宿主一点点，iOS 用不透明的同一色。 */
  overlay: 'rgba(18, 20, 24, 0.96)',
  overlaySolid: '#121418',
  /** 语音通话页的径向渐变底。视频页被画面盖住，用不到。 */
  callGradient: 'radial-gradient(120% 70% at 50% 0%, #2A3350, #0F1117 65%)',
  /** 格子底：没有画面时露出来的那层，也是视频的信箱边。 */
  tile: '#000000',
  /** 头像兜底底色（没有头像图、也没算出渐变时）。 */
  avatar: '#2B3038',
  /** 控制按钮常态 / hover。 */
  ctlIdle: 'rgba(255, 255, 255, 0.14)',
  ctlHover: 'rgba(255, 255, 255, 0.22)',
  /** 开启态：**反白，不是变蓝**。 */
  ctlOn: '#FFFFFF',
  ctlOnFg: '#121418',
  ctlOnPressed: 'rgba(255, 255, 255, 0.88)',
  /** 挂断 / 拒绝 / 取消。恒红，不随主题。 */
  danger: '#E5484D',
  dangerPressed: '#C93B40',
  /** 接听按钮 + **正在说话的格子描边**。绿色在通话页只有这两个含义。 */
  accept: '#3DDC84',
  acceptFg: '#08210F',
  acceptPressed: '#2FBE6F',
  fg: '#FFFFFF',
  fgDim: 'rgba(255, 255, 255, 0.7)',
  /** 「网络不佳」「正在重连…」的横幅与角标。 */
  warning: '#F5A623',
  /** 格子上「对方已静音」角标的图标色。 */
  mutedBadge: '#FFB4AE',
  /** 来电横幅 / Toast / 小窗底。 */
  banner: '#1E2330',
  /** 格子上名字标签、角标的黑底。 */
  scrim: 'rgba(0, 0, 0, 0.55)',
} as const;

/** callMetrics 是尺寸（规范 §04）。单位 px；四端数值相同。 */
export const callMetrics = {
  control: 56,
  controlBig: 64,
  controlSmall: 44,
  icon: 26,
  iconBig: 30,
  iconSmall: 22,
  controlGap: 12,
  captionGap: 7,
  avatarLarge: 96,
  tileGap: 8,
  tileRadius: 10,
  speakingOutline: 2.5,
  /** 本端 / 对端小窗：竖屏容器 3:4，横屏容器 16:9。 */
  pipPortrait: { width: 96, height: 128 },
  pipLandscape: { width: 160, height: 90 },
  pipRadius: 12,
  /** 小窗离容器边缘的距离（安全区之内再留 12）。 */
  pipInset: 12,
  /** 控制条显示时，停在下面两个角的小窗要上移这么多。 */
  pipLift: 88,
  /** 顶部标题区与底部控制条的固定高度：中间区域靠约束吃掉剩余空间。 */
  headerHeight: 64,
  controlsHeight: 96,
  /** 页内小窗：视频区 16:9 + 底栏 36。 */
  miniWidth: 180,
  miniBar: 36,
  bannerHeight: 62,
} as const;

/** callMotion 是动效时长（规范 §07）。除了这些，通话页不要再加动画。 */
export const callMotion = {
  pressMs: 120,
  releaseMs: 160,
  snapMs: 250,
  swapMs: 260,
  fadeMs: 200,
  /** 视频通话里控制条多久后自动隐藏。 */
  autoHideMs: 3000,
  /** 手机上小窗要长按这么久才进拖动态（桌面鼠标直接拖）。 */
  longPressMs: 350,
  /** 发言描边**灭**的延迟——防频闪，不是审美选择。 */
  speakingOffMs: 600,
  /** 邀请中的占位格「已拒绝 / 未接听」停多久再移除。 */
  settledHoldMs: 2000,
  /** 一次性提示（「通话已满员」「对方已拒接」）停多久自己撤掉。 */
  hintHoldMs: 3000,
  /** 「对方网络不佳」横幅多久后收起成角标。 */
  networkBannerMs: 2000,
} as const;

/**
 * avatarGradients 是头像的九个渐变（规范 §02）。取哪一个见 `avatarGradient()`：
 * **同一个 uid 在四端、每一次通话里必须是同一个颜色**。
 */
export const avatarGradients: readonly string[] = [
  'linear-gradient(160deg, #9E7BF0, #6E52D6)',
  'linear-gradient(160deg, #3AA0FF, #0A6BE0)',
  'linear-gradient(160deg, #4CD268, #28B14A)',
  'linear-gradient(160deg, #FBB040, #F5872B)',
  'linear-gradient(160deg, #FF7AA8, #E0559E)',
  'linear-gradient(160deg, #5ED3D0, #2AA6A3)',
  'linear-gradient(160deg, #B0B8C8, #7E8797)',
  'linear-gradient(160deg, #F08A5D, #C94F3B)',
  'linear-gradient(160deg, #7C9CF0, #4C6BD6)',
];

/** callFont 是字体栈：四端都用系统字，不打包字体（规范 §03）。 */
export const callFont =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';
