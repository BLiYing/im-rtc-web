// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteLogSink } from '../src/remoteLog.js';

/**
 * `start()` 原先每次都用一个匿名函数注册 `pagehide`，`stop()` 从不摘除——
 * 反复 start/stop 会一直往 `window` 上叠监听器。这里钉住修好之后的两条：
 * 重复 start 不叠加、stop 之后监听器真的被摘掉。
 */
describe('RemoteLogSink：pagehide 监听器不泄漏', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('重复 start 不叠加监听器', () => {
    const sink = new RemoteLogSink('http://example.test', 'client-1');
    const addSpy = vi.spyOn(window, 'addEventListener');

    sink.start();
    sink.start();
    sink.start();

    expect(addSpy.mock.calls.filter(([type]) => type === 'pagehide')).toHaveLength(1);
    sink.stop();
  });

  it('stop 摘掉监听器；摘掉之后再 dispatch pagehide 不会再触发上报', async () => {
    const sink = new RemoteLogSink('http://example.test', 'client-1');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    sink.start();
    sink.stop();

    expect(removeSpy.mock.calls.filter(([type]) => type === 'pagehide')).toHaveLength(1);

    sink.push({ at_ms: Date.now(), level: 'info', msg: 'm', fields: {} });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const callsBeforeDispatch = fetchMock.mock.calls.length;
    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();

    // 监听器已经被摘掉：dispatch 不该再触发一次 fetch。
    expect(fetchMock.mock.calls.length).toBe(callsBeforeDispatch);
  });
});
