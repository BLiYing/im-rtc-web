import { describe, expect, it } from 'vitest';

import { VideoProfiles, defaultVideoProfile, videoConstraints } from '../src/media/videoProfile.js';

describe('画质档位', () => {
  it('默认是 720p——1080p 在九宫格里只是白烧上行带宽', () => {
    expect(defaultVideoProfile).toBe(VideoProfiles.p720);
  });

  /*
    `exact` 会在不支持该分辨率的摄像头上抛 OverconstrainedError，通话直接打不出去。
    画质是偏好不是硬条件，所以只能用 ideal。
  */
  it('约束用 ideal 不用 exact', () => {
    const constraints = videoConstraints(VideoProfiles.p1080);
    expect(constraints.width).toEqual({ ideal: 1920 });
    expect(constraints.height).toEqual({ ideal: 1080 });
    expect(constraints.frameRate).toEqual({ ideal: 30 });
    expect(JSON.stringify(constraints)).not.toContain('exact');
  });

  /*
    这个数字要和服务端 internal/sfu/bwe.go 的 bitrateHigh 对得上：
    那边拿它做带宽预算，对不上的话降层判断是按一个错的数字做的。
  */
  it('720p 的码率与服务端 simulcast h 层的目标值一致', () => {
    expect(VideoProfiles.p720.maxBitrateBps).toBe(1_500_000);
  });
});
