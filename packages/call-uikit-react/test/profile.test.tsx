import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CallProvider } from '../src/CallProvider.js';
import { CallOverlay } from '../src/components/CallOverlay.js';
import { ProfileProvider } from '../src/profile.js';
import type { ParticipantProfile, ProfileResolver } from '../src/profile.js';
import { FakeEngine, asEngine } from './fakeEngine.js';

/**
 * 宿主身份解析（profile.tsx）。
 *
 * 最要紧的一条是**同一个 uid 在不同设备上显示不同的名字**——那正是备注的语义，
 * 也正是这份信息不能走服务端广播、必须由宿主本机解析的原因。
 */

/** fakeResolver 造一个可以「稍后才解析出来」的解析器，模拟批量拉取的真实行为。 */
function fakeResolver(initial: Record<string, ParticipantProfile>): {
  resolver: ProfileResolver;
  resolveLater: (uid: string, profile: ParticipantProfile) => void;
} {
  const table = new Map(Object.entries(initial));
  const listeners = new Set<(uids: readonly string[]) => void>();
  return {
    resolver: {
      resolve: (uid) => table.get(uid),
      subscribe: (onResolved) => {
        listeners.add(onResolved);
        return () => listeners.delete(onResolved);
      },
    },
    resolveLater: (uid, profile) => {
      table.set(uid, profile);
      for (const fn of listeners) fn([uid]);
    },
  };
}

/** setup 起一通已接通的 1v1，远端是 `peerUid`。 */
async function setup(resolver: ProfileResolver | null, peerUid = '4820571639'): Promise<FakeEngine> {
  const engine = new FakeEngine();
  const tree = (
    <CallProvider engine={asEngine(engine)} endedHoldMs={0}>
      <CallOverlay />
    </CallProvider>
  );
  render(resolver === null ? tree : <ProfileProvider resolver={resolver}>{tree}</ProfileProvider>);

  act(() => {
    engine.emit('callReceived', {
      callId: 'c-1', caller: peerUid, calleeIds: [peerUid, 'me'],
      mediaType: 'video', isGroup: false,
    });
  });
  return engine;
}

// 与本包其它用例同一套清理：不清的话上一条留下的横幅会让 getByTestId 撞到多个。
afterEach(() => {
  document.body.innerHTML = '';
});

describe('宿主身份解析', () => {
  it('没有 ProfileProvider 时原样显示 uid —— 与加钩子之前完全一致', async () => {
    await setup(null);
    expect(screen.getByTestId('incoming-call').textContent).toContain('4820571639');
  });

  it('有解析器时显示宿主给的名字，而不是 uid', async () => {
    const { resolver } = fakeResolver({ '4820571639': { name: '明子' } });
    await setup(resolver);

    const banner = screen.getByTestId('incoming-call');
    expect(banner.textContent).toContain('明子');
    expect(banner.textContent).not.toContain('4820571639');
  });

  /*
    这一条是整件事的立足点：同一个 uid，两台设备两个名字（各自的备注）。
    如果显示名走服务端广播，这个用例根本不可能通过。
  */
  it('同一个 uid 在两个解析器下显示不同的名字（备注是查看者私有的）', async () => {
    const a = fakeResolver({ u1: { name: '老张（欠我钱）' } });
    await setup(a.resolver, 'u1');
    expect(screen.getByTestId('incoming-call').textContent).toContain('老张（欠我钱）');

    // 换一台设备 = 换一个解析器，同一个 uid 显示成另一个名字。
    document.body.innerHTML = '';
    const b = fakeResolver({ u1: { name: '张经理' } });
    await setup(b.resolver, 'u1');
    expect(screen.getByTestId('incoming-call').textContent).toContain('张经理');
  });

  /*
    宿主的解析器是「命中就返回、没命中先返回空并在后台拉一批」。所以第一帧解析不到
    是**正常路径**，Kit 必须先画兜底、等通知再重画——不重画的话陌生人来电会一直显示 uid。
  */
  it('解析稍后才回来时会重画', async () => {
    const { resolver, resolveLater } = fakeResolver({});
    await setup(resolver);
    expect(screen.getByTestId('incoming-call').textContent).toContain('4820571639');

    act(() => {
      resolveLater('4820571639', { name: '小明' });
    });
    expect(screen.getByTestId('incoming-call').textContent).toContain('小明');
  });

  /*
    「查到了但名字是空的」比「没查到」更糟：直接用会让格子上什么都没有。
    这时该退回兜底。
  */
  it('名字是空白时退回兜底，而不是显示一个空名', async () => {
    const { resolver } = fakeResolver({ '4820571639': { name: '   ' } });
    await setup(resolver);
    expect(screen.getByTestId('incoming-call').textContent).toContain('4820571639');
  });

  it('有头像地址时显示图片，没有时退化成首字母色块', async () => {
    const { resolver } = fakeResolver({
      '4820571639': { name: '小明', avatarUrl: 'https://example.test/a.jpg' },
    });
    await setup(resolver);

    const img = screen.getByTestId('incoming-avatar');
    expect(img.getAttribute('src')).toBe('https://example.test/a.jpg');
  });

  it('没有头像地址时不出 <img>', async () => {
    const { resolver } = fakeResolver({ '4820571639': { name: '小明' } });
    await setup(resolver);
    expect(screen.queryByTestId('incoming-avatar')).toBeNull();
  });
});
