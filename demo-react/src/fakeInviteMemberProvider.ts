import type { InviteMemberProvider } from 'im-rtc-call-uikit-react';

import { DEMO_CONTACTS } from './contacts.js';

/**
 * fakeInviteMemberProvider 是 Demo 验收用的假 provider（HOST_INTEGRATION_DESIGN §3.4）。
 *
 * 真实宿主的 provider 会去查群成员表；Demo 没有后端群组数据，所以自己拼一份：
 * **真实在线的 Demo 账号排在前面**（这些人真的能接得起来，双开标签页联调对得上），
 * 后面**补几十个假成员凑够分页**（`FAKE_MEMBER_COUNT` > 一页大小，滚到底才有意义）。
 *
 * 两个特殊搜索词，专门验证 uikit 的三态（`InvitePicker` §3.4）：
 * - `fail` → 立刻 reject，验证「加载失败带重试」；
 * - `slow` → 永远不 resolve，验证「10 秒无回调算超时」（容信 iOS 现有实现踩过的坑）。
 */

/** PAGE_SIZE 一页给多少条。故意比 `FAKE_MEMBER_COUNT` 小很多，滚到底才能翻出第二页。 */
const PAGE_SIZE = 12;
/** FAKE_MEMBER_COUNT 补多少个假成员——够翻好几页。 */
const FAKE_MEMBER_COUNT = 40;
/** FAKE_LATENCY_MS 模拟一点网络延迟，Demo 里能看见「加载中…」而不是瞬间刷新。 */
const FAKE_LATENCY_MS = 350;

interface Candidate {
  readonly uid: string;
  readonly name: string;
}

function allCandidates(): readonly Candidate[] {
  const real = DEMO_CONTACTS.map((c) => ({ uid: c.uid, name: c.uid }));
  const fake = Array.from({ length: FAKE_MEMBER_COUNT }, (_, i) => ({
    uid: `fake-${i + 1}`,
    name: `群成员 ${i + 1}`,
  }));
  return [...real, ...fake];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const fakeInviteMemberProvider: InviteMemberProvider = async (_ctx, query, cursor) => {
  const q = query.trim().toLowerCase();
  if (q === 'fail') {
    await delay(FAKE_LATENCY_MS);
    throw new Error('demo: 模拟 inviteMemberProvider 失败');
  }
  if (q === 'slow') {
    // 模拟宿主没回调：永远不 resolve。uikit 的 10 秒超时会接住这个。
    return new Promise(() => { /* 故意空着 */ });
  }

  await delay(FAKE_LATENCY_MS);

  // 不剔自己与发起人：uikit 会把在通话里的人置灰「已在通话中」。
  const matched = allCandidates().filter((c) =>
    q === '' || c.uid.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));

  const offset = cursor === undefined ? 0 : Number.parseInt(cursor, 10) || 0;
  const page = matched.slice(offset, offset + PAGE_SIZE);
  const nextOffset = offset + PAGE_SIZE;
  return {
    items: page,
    ...(nextOffset < matched.length ? { nextCursor: String(nextOffset) } : {}),
  };
};
