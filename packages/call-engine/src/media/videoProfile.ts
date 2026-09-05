/**
 * 视频画质档位。
 *
 * # 为什么是「宿主给」而不是「服务端下发」
 *
 * 与换 token 是同一条边界（协议 §1.5）：**策略归宿主，engine 不自己去要。**
 * 画质该多高取决于宿主的业务（付费档位、当前网络、机型），engine 不认识那些东西。
 * 宿主要「后台可控」就把这个值放进自己的配置接口里下发给 App——
 * 那正是宿主后台该管的事，也不需要动 RTC 协议。
 *
 * （真要让 **RTC 服务端**统一下发，那是往 `sys.hello.ok.limits` 加字段，
 * 等于改五个仓 + 一致性向量，是单独一刀，不该混在别的改动里。）
 *
 * # 档位怎么定
 *
 * 分辨率按主流三档；码率取的是 simulcast 最高层的目标值（协议 §3.5 的表）。
 * **`maxBitrateBps` 必须和服务端 `internal/sfu/bwe.go` 的 `bitrateHigh` 对得上**：
 * 那边拿它做带宽预算，两边不一致的话，带宽估计会按一个错的数字去决定降不降层。
 */
export interface VideoProfile {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  /** 最高层的目标码率。simulcast 的 m / l 层按 1/3、1/10 折算。 */
  readonly maxBitrateBps: number;
}

/** 三个预设档位。默认 720p——1080p 在九宫格里没有意义，只是白烧上行带宽。 */
export const VideoProfiles = {
  p360: { name: '360p', width: 640, height: 360, frameRate: 24, maxBitrateBps: 500_000 },
  p720: { name: '720p', width: 1280, height: 720, frameRate: 30, maxBitrateBps: 1_500_000 },
  p1080: { name: '1080p', width: 1920, height: 1080, frameRate: 30, maxBitrateBps: 3_000_000 },
} as const satisfies Record<string, VideoProfile>;

/** 缺省档位。 */
export const defaultVideoProfile: VideoProfile = VideoProfiles.p720;

/**
 * videoConstraints 把档位翻成 `getUserMedia` 的约束。
 *
 * 用 `ideal` 不用 `exact`：**`exact` 在不支持该分辨率的摄像头上直接抛
 * `OverconstrainedError`，通话就打不出去了**。画质是偏好，不是硬条件。
 */
export function videoConstraints(profile: VideoProfile): MediaTrackConstraints {
  return {
    width: { ideal: profile.width },
    height: { ideal: profile.height },
    frameRate: { ideal: profile.frameRate },
  };
}
