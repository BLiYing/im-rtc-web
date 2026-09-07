import { describe, expect, it } from 'vitest';

import { checkDeviceId } from '../src/deviceId.js';
import { CallEngine } from '../src/engine.js';
import { FakeWebSocket, flush } from './fakeWebSocket.js';
import { NullMedia } from './nullMedia.js';
import { ErrorCode, isRtcError } from '../src/errors.js';

/**
 * `device_id` 的入参校验（协议 §2.5）。
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
    expect(msg).toContain('64');
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
 * 光有校验函数不算数——**它得真的挂在路径上**。
 *
 * 这一组走门面 `login()`，断言在**开 socket 之前**就失败了。少了这条，
 * `deviceId.ts` 可以是一个从没人调用的完美函数。
 */
describe('login() 之前就拦下', () => {
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

  it('device_id 带空格：login 直接失败，一条连接都没开', async () => {
    const { engine, sockets } = engineWith('Pixel 2 XL');

    await expect(engine.login('test-token')).rejects.toSatisfy(
      (err: unknown) => isRtcError(err) && err.code === ErrorCode.badParams,
    );
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
});
