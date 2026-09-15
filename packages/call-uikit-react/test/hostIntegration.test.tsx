import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, RtcError } from '@im-rtc/call-engine';

import type { CallProviderProps } from '../src/CallProvider.js';
import { CallProvider } from '../src/CallProvider.js';
import { CallOverlay } from '../src/components/CallOverlay.js';
import type { InviteContext, InvitePage, InviteProvider } from '../src/invite/types.js';
import { useCall } from '../src/useCall.js';
import { FakeEngine, asEngine } from './fakeEngine.js';

/**
 * HOST_INTEGRATION_DESIGN §3.4：`inviteProvider` / `onInviteRequest` / `canInvite` /
 * `allowManualUidInput`，以及 `useCall().joinCall`（§3.3/§3.4，协议 `call.join`）。
 *
 * 静态 `inviteCandidates` 的老路径由 `interactions.test.tsx` 守着，这里只加新东西。
 */

/** JoinCallButton 是测试用的宿主入口：uikit 没有「按 call_id 加入」的按钮，那是宿主的界面。 */
function JoinCallButton(): ReactNode {
  const { joinCall } = useCall();
  return <button type="button" data-testid="join-call" onClick={() => void joinCall('call-9')}>加入</button>;
}

function setup(engine: FakeEngine, props: Partial<CallProviderProps> = {}): void {
  render(
    <CallProvider engine={asEngine(engine)} endedHoldMs={5000} {...props}>
      <JoinCallButton />
      <CallOverlay />
    </CallProvider>,
  );
}

function connectGroup(engine: FakeEngine, extra: { chatGroupId?: string; userData?: string } = {}): void {
  act(() => {
    engine.emit('callBegin', {
      callId: 'c-1', roomId: 'r-1', mediaType: 'video', isGroup: true, role: 'caller',
      caller: 'me', chatGroupId: extra.chatGroupId ?? '', userData: extra.userData ?? '',
    });
    engine.emit('roomJoined', { roomId: 'r-1' });
    engine.emit('userEnter', { uid: 'bob' });
  });
}

/**
 * flush 等挂起的 Promise 回调跑完，**包括真实的 0ms 定时器**（provider 的首次加载
 * 走的是 `setTimeout(fn, 0)`，不经过一轮真正的宏任务它落不了地）。
 * 与 `interactions.test.tsx` 的同名函数同一个写法——那边踩过纯微任务 `Promise.resolve()`
 * 在有系统负载时不够稳的坑（本文件的分页用例最初就是这么挂的）。
 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('joinCall()：主动加入进行中的群通话', () => {
  it('立刻进「接通中…」，不经过来电页', () => {
    const engine = new FakeEngine();
    setup(engine);
    fireEvent.click(screen.getByTestId('join-call'));
    expect(screen.getByTestId('active-call').textContent).toContain('接通中…');
    expect(screen.queryByTestId('incoming-page')).toBeNull();
  });

  it('call.connected 到了之后拿到 caller / chatGroupId，正常进入通话', async () => {
    const engine = new FakeEngine();
    setup(engine);
    fireEvent.click(screen.getByTestId('join-call'));
    await flush();
    act(() => {
      engine.emit('callBegin', {
        callId: 'call-9', roomId: 'r-9', mediaType: 'video', isGroup: true, role: 'callee',
        caller: 'frank', chatGroupId: 'g-42', userData: '',
      });
      engine.emit('roomJoined', { roomId: 'r-9' });
    });
    expect(screen.getByTestId('active-call').getAttribute('data-layout')).toBe('grid');
  });

  it('被服务端拒绝（如 1409）：按同一句文案提示，走既有的 callEnd 出口收场', async () => {
    const engine = new FakeEngine();
    engine.joinCallError = { code: ErrorCode.inviteDenied, name: 'invite_denied', message: 'invite denied by host' };
    setup(engine);
    fireEvent.click(screen.getByTestId('join-call'));
    await flush();
    expect(screen.getByTestId('call-ended').textContent).toContain('无法加入该通话');
  });

  it('通话中再 joinCall：不动当前通话、不发 call.join，只提示（2026-09-15 代码审查）', async () => {
    const engine = new FakeEngine();
    setup(engine);
    connectGroup(engine);
    fireEvent.click(screen.getByTestId('join-call'));
    await flush();
    expect(engine.calls).not.toContain('joinCall:call-9');
    expect(screen.getByTestId('active-call').textContent).not.toContain('接通中…');
    expect(document.body.textContent).toContain('正在通话中，无法加入');
  });

  it('加入期间冒出无关的 error：以通话状态为准，不收场', async () => {
    const engine = new FakeEngine();
    engine.joinCallStrayError = { code: ErrorCode.networkUnreachable, name: 'network_unreachable', message: 'x' };
    setup(engine);
    fireEvent.click(screen.getByTestId('join-call'));
    await flush();
    expect(screen.queryByTestId('call-ended')).toBeNull();
    expect(screen.getByTestId('active-call').textContent).toContain('接通中…');
  });

  it('麦克风被拒：出「无法通话」卡，不发 call.join，点掉之后界面收回（与拨出同一条路）', async () => {
    const engine = new FakeEngine();
    engine.probeError = new RtcError(ErrorCode.devicePermissionDenied);
    setup(engine);
    fireEvent.click(screen.getByTestId('join-call'));
    await flush();
    expect(screen.getByTestId('prompt-blocked').textContent).toContain('没有麦克风权限');
    expect(engine.calls).not.toContain('joinCall:call-9');

    fireEvent.click(screen.getByTestId('prompt-blocked-primary'));
    await flush();
    expect(screen.queryByTestId('active-call')).toBeNull();
    expect(engine.calls).not.toContain('joinCall:call-9');
  });
});

describe('inviteProvider：按通话向宿主要候选人', () => {
  function page(items: { uid: string; name?: string }[], nextCursor?: string): InvitePage {
    return { items, ...(nextCursor === undefined ? {} : { nextCursor }) };
  }

  it('打开选人页立刻要第一页，不防抖；ctx 里带得上群号', async () => {
    const engine = new FakeEngine();
    const provider = vi.fn<InviteProvider>(async (ctx: InviteContext) => {
      expect(ctx.chatGroupId).toBe('g-42');
      expect(ctx.callId).toBe('c-1');
      return page([{ uid: 'dave', name: '戴夫' }]);
    });
    setup(engine, { inviteProvider: provider });
    connectGroup(engine, { chatGroupId: 'g-42' });

    fireEvent.click(screen.getByTestId('invite-button'));
    await flush();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('invite-row-dave')).toBeTruthy();
  });

  it('停止输入 300ms 才发请求；连续敲字只有最后一次落地（新请求作废旧结果）', async () => {
    vi.useFakeTimers();
    const engine = new FakeEngine();
    let resolveSlow: ((p: InvitePage) => void) | null = null;
    const provider = vi.fn<InviteProvider>(async (_ctx, query) => {
      if (query === 'd') return new Promise((resolve) => { resolveSlow = resolve; });
      return page([{ uid: `${query}-x` }]);
    });
    setup(engine, { inviteProvider: provider });
    connectGroup(engine);

    fireEvent.click(screen.getByTestId('invite-button'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // 首次加载（不防抖）落地
    provider.mockClear();

    fireEvent.change(screen.getByTestId('invite-search'), { target: { value: 'd' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    fireEvent.change(screen.getByTestId('invite-search'), { target: { value: 'da' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    // 还没到 300ms：一次请求都不该发生。
    expect(provider).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledWith(expect.anything(), 'da', undefined);

    // 那个更早、字符是 'd' 的慢请求现在才回来：必须被当作过期结果丢弃。
    await act(async () => { resolveSlow?.(page([{ uid: 'stale' }])); });
    expect(screen.queryByTestId('invite-row-stale')).toBeNull();
    expect(screen.getByTestId('invite-row-da-x')).toBeTruthy();
  });

  it('加载失败带重试；重试成功后列表恢复', async () => {
    const engine = new FakeEngine();
    let shouldFail = true;
    const provider = vi.fn<InviteProvider>(async () => {
      if (shouldFail) throw new Error('network');
      return page([{ uid: 'dave' }]);
    });
    setup(engine, { inviteProvider: provider });
    connectGroup(engine);

    fireEvent.click(screen.getByTestId('invite-button'));
    await flush();
    expect(screen.getByTestId('invite-state').textContent).toContain('加载失败');

    shouldFail = false;
    fireEvent.click(screen.getByTestId('invite-retry'));
    await flush();
    expect(screen.getByTestId('invite-row-dave')).toBeTruthy();
  });

  it('10 秒没回调算超时（容信 iOS 那种「永远转圈」的坑），超时后也能重试', async () => {
    vi.useFakeTimers();
    const engine = new FakeEngine();
    let hang = true;
    const provider = vi.fn<InviteProvider>(async () => {
      if (hang) return new Promise(() => { /* 永远不 resolve，模拟宿主没回调 */ });
      return page([{ uid: 'dave' }]);
    });
    setup(engine, { inviteProvider: provider });
    connectGroup(engine);

    fireEvent.click(screen.getByTestId('invite-button'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('invite-state').textContent).toContain('加载中');

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByTestId('invite-state').textContent).toContain('请求超时');

    hang = false;
    fireEvent.click(screen.getByTestId('invite-retry'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('invite-row-dave')).toBeTruthy();
  });

  it('滚到底且有 nextCursor 时取下一页，条目是追加不是替换', async () => {
    const engine = new FakeEngine();
    const provider = vi.fn<InviteProvider>(async (_ctx, _q, cursor) =>
      cursor === undefined ? page([{ uid: 'p1' }], 'cursor-2') : page([{ uid: 'p2' }]));
    setup(engine, { inviteProvider: provider });
    connectGroup(engine);

    fireEvent.click(screen.getByTestId('invite-button'));
    await flush();
    expect(screen.getByTestId('invite-row-p1')).toBeTruthy();
    expect(screen.queryByTestId('invite-row-p2')).toBeNull();

    const list = screen.getByTestId('invite-list');
    Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 490, configurable: true });
    fireEvent.scroll(list);
    await flush();

    expect(provider).toHaveBeenLastCalledWith(expect.anything(), '', 'cursor-2');
    expect(screen.getByTestId('invite-row-p1')).toBeTruthy();
    expect(screen.getByTestId('invite-row-p2')).toBeTruthy();
  });

  it('已在通话中的人置灰不可选；selectable:false 的候选人按 unselectableReason 置灰', async () => {
    const engine = new FakeEngine();
    const provider = vi.fn<InviteProvider>(async () =>
      page([{ uid: 'bob' }, { uid: 'erin', selectable: false, unselectableReason: '群禁言中' }]));
    setup(engine, { inviteProvider: provider });
    connectGroup(engine);

    fireEvent.click(screen.getByTestId('invite-button'));
    await flush();
    expect(screen.getByTestId('invite-row-bob').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('invite-row-bob').textContent).toContain('已在通话中');
    expect(screen.getByTestId('invite-row-erin').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('invite-row-erin').textContent).toContain('群禁言中');
  });
});

describe('onInviteRequest：整页交给宿主', () => {
  it('接管时根本不挂载 InvitePicker，选完直接调 inviteMore', async () => {
    const engine = new FakeEngine();
    const onInviteRequest = vi.fn(async (ctx: InviteContext) => {
      expect(ctx.slotsLeft).toBe(7);
      return ['dave'];
    });
    setup(engine, { onInviteRequest });
    connectGroup(engine);

    fireEvent.click(screen.getByTestId('invite-button'));
    await flush();
    expect(screen.queryByTestId('invite-picker')).toBeNull();
    expect(onInviteRequest).toHaveBeenCalledTimes(1);
    expect(engine.calls).toContain('inviteMore:dave');
  });

  it('返回空数组＝用户取消：不调 inviteMore', async () => {
    const engine = new FakeEngine();
    setup(engine, { onInviteRequest: async () => [] });
    connectGroup(engine);
    fireEvent.click(screen.getByTestId('invite-button'));
    await flush();
    expect(engine.calls.some((c) => c.startsWith('inviteMore'))).toBe(false);
  });

  it('返回 null＝不接管：退回正常的 InvitePicker（这里退到静态名单）', async () => {
    const engine = new FakeEngine();
    setup(engine, { onInviteRequest: async () => null, inviteCandidates: [{ uid: 'dave' }] });
    connectGroup(engine);
    fireEvent.click(screen.getByTestId('invite-button'));
    await flush();
    expect(screen.getByTestId('invite-picker')).toBeTruthy();
    expect(screen.getByTestId('invite-row-dave')).toBeTruthy();
  });
});

describe('canInvite：宿主的权限规则', () => {
  it('返回 false 时不给「加人」入口', () => {
    const engine = new FakeEngine();
    setup(engine, { canInvite: () => false });
    connectGroup(engine);
    expect(screen.queryByTestId('invite-button')).toBeNull();
  });

  it('不给 canInvite 时按 true 处理——按钮照常在', () => {
    const engine = new FakeEngine();
    setup(engine);
    connectGroup(engine);
    expect(screen.getByTestId('invite-button')).toBeTruthy();
  });
});
