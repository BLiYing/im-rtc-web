import { describe, expect, it } from 'vitest';

import { ErrorCode, isRtcError } from '../src/errors.js';
import { CallEngine } from '../src/engine.js';
import * as publicApi from '../src/index.js';
import { checkDeviceId, checkRoomId } from '../src/protocolId.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';
import { NullMedia } from './nullMedia.js';

/**
 * §2.5 那一列 id 的入参校验。
 *
 * 这一层的价值不是"多一道防线"，而是**把服务端那句话送到宿主手里**：
 * 不拦的话服务端回 1004，宿主只看到 `bad_params`，界面上是「登录失败」四个字。
 */

/** reason 取出 cause 里那句人话——RtcError 自己的 message 是固定短语。 */
function reason(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    if (!isRtcError(err)) return `不是 RtcError: ${String(err)}`;
    if (err.code !== ErrorCode.badParams) return `码不对: ${err.code}`;
    return err.cause instanceof Error ? err.cause.message : '没有 cause';
  }
  return '没有抛';
}

describe('checkDeviceId', () => {
  it.each([
    ['纯字母数字', 'web1'],
    ['带连字符（UUID 就长这样）', '3f2b8c1a-9d4e-4f77-8a21-0b5c6d7e8f90'],
    ['带下划线', 'chrome_mac_01'],
    ['正好 64 字节', 'a'.repeat(64)],
  ])('放行：%s', (_name, id) => {
    expect(() => checkDeviceId(id)).not.toThrow();
  });

  it('空串：不能空', () => {
    expect(reason(() => checkDeviceId(''))).toContain('不能为空');
  });

  it('65 字节：超上限，且把实际长度说出来', () => {
    const msg = reason(() => checkDeviceId('a'.repeat(65)));
    expect(msg).toContain('65 字节');
    expect(msg).toContain('上限 64');
  });

  it('中文按字节算，不按字符 —— 22 个汉字就超了', () => {
    // 22 × 3 = 66 字节，但只有 22 个字符；按字符算会漏过去。
    expect(reason(() => checkDeviceId('设'.repeat(22)))).toContain('66 字节');
  });

  it('带空格：报出到底是哪个字符 —— 这就是 Pixel 2 XL 那个 bug', () => {
    const msg = reason(() => checkDeviceId('Pixel 2 XL'));
    expect(msg).toContain("' '");
    expect(msg).toContain('[A-Za-z0-9_-]');
  });

  it.each([
    ['括号（moto g(7) power）', 'moto g(7) power'],
    ['点号', 'web.1'],
    ['斜杠（userAgent 里到处是）', 'Mozilla/5.0'],
    ['冒号', 'mac:01'],
  ])('拦下：%s', (_name, id) => {
    expect(reason(() => checkDeviceId(id))).toContain('[A-Za-z0-9_-]');
  });

  it('emoji 按码点报，不劈成两个半拉代理对', () => {
    expect(reason(() => checkDeviceId('web-😀'))).toContain("'😀'");
  });

  it('抛的码和服务端拒绝时是同一个 1004 —— 宿主不用写两遍分支', () => {
    try {
      checkDeviceId('bad id');
      expect.unreachable('本该抛');
    } catch (err) {
      expect(isRtcError(err) && err.code).toBe(ErrorCode.badParams);
    }
  });
});

/**
 * **非字符串必须拦住**，这是最阴的一档：`undefined` 会三关全过。
 *
 * `undefined === ''` 是 false；`TextEncoder.encode(undefined)` 按规范把参数默认成
 * `''`，算出来 0 字节；`ALLOWED.test(undefined)` 先转成字符串 `'undefined'`，
 * 正好全是合规字符。放过去之后服务端拒掉，症状回到这个模块存在的理由本身。
 *
 * 类型签名挡不住这一档：宿主可能是 JS，也可能把一个没取到的配置直接传进来。
 */
describe('非字符串', () => {
  it.each([
    ['undefined（没取到的配置）', undefined],
    ['null', null],
    ['数字', 123],
    ['布尔', true],
    ['对象', {}],
  ])('拦下：%s', (_name, value) => {
    // 故意绕开类型签名：这里模拟的就是「宿主是 JS」那条路径。
    const msg = reason(() => checkDeviceId(value as unknown as string));
    expect(msg).toContain('必须是字符串');
  });

  it('null 的类型名单独说，不报成 object', () => {
    expect(reason(() => checkDeviceId(null as unknown as string))).toContain('得到 null');
  });
});

describe('checkRoomId', () => {
  it('放行服务端分配的那种房间号', () => {
    expect(() => checkRoomId('r-8812')).not.toThrow();
  });

  it('拿群名当房间号：拦下，并说清楚是哪个字符', () => {
    const msg = reason(() => checkRoomId('产品组 日常'));
    expect(msg).toContain('room_id');
    expect(msg).toContain('[A-Za-z0-9_-]');
  });
});

/**
 * 光有校验函数不算数——**它得真的挂在路径上**。
 *
 * 少了这一组，`protocolId.ts` 可以是一套从没人调用的完美函数。
 */
describe('挂在路径上', () => {
  function engineWith(deviceId: string): { engine: CallEngine; sockets: FakeWebSocket[] } {
    const sockets: FakeWebSocket[] = [];
    const engine = new CallEngine({
      url: 'ws://test/v1/ws',
      deviceId,
      media: new NullMedia(),
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.open());
        return socket;
      },
    });
    return { engine, sockets };
  }

  /*
    **构造就拦，不等到 login()**——与 Android 的 `Config.init` 对齐。
    差别是实打实的：宿主一般先去自己的账号体系取票、再 new engine、最后 login，
    拦在 login 上意味着那趟取票的网络往返白跑了才告诉他机型名里有空格。
  */
  it('device_id 带空格：构造就失败，一条连接都没开', () => {
    const sockets: FakeWebSocket[] = [];
    expect(() => {
      new CallEngine({
        url: 'ws://test/v1/ws',
        deviceId: 'Pixel 2 XL',
        media: new NullMedia(),
        webSocketFactory: () => {
          const socket = new FakeWebSocket();
          sockets.push(socket);
          return socket;
        },
      });
    }).toThrow();
    expect(sockets).toHaveLength(0);
  });

  it('合规的 device_id 照常连上去', async () => {
    const { engine, sockets } = engineWith('web-1');
    void engine.login('test-token').catch(() => {});
    await flush();
    expect(sockets).toHaveLength(1);
    // **必须收尾**：不 logout 的话这条连接会挂在握手上等超时，
    // 连同它的定时器一起漏进同一个 worker 里后跑的用例——
    // 踩过一次，engineTokenLifecycle 那个计时敏感的用例被它拖超时了。
    engine.logout();
  });

  it('joinRoom 的 room_id 也拦，且抢在 dispatch 之前（没登录也是这个码）', async () => {
    const { engine } = engineWith('web-1');
    await expect(engine.joinRoom('team meeting', 'rt-1')).rejects.toSatisfy(
      (err: unknown) => isRtcError(err) && err.code === ErrorCode.badParams,
    );
    engine.logout();
  });
});

/**
 * 导出面也要有人钉着。
 *
 * 测试都从 `../src/protocolId.js` 直接 import，于是 `index.ts` 那行 export
 * 被删掉或改名时，整套测试照样全绿，而宿主眼里这个 API 已经没了——
 * 「宿主可以自己先验一遍」正是加这个导出的全部理由。
 */
describe('公开导出', () => {
  it('checkDeviceId / checkRoomId 从包入口出得来', () => {
    expect(publicApi.checkDeviceId).toBe(checkDeviceId);
    expect(publicApi.checkRoomId).toBe(checkRoomId);
  });
});
