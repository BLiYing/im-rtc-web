import { describe, expect, it } from 'vitest';

import { CallEngine } from '../src/engine.js';
import {
  callHistoryUrl,
  fetchCallHistory,
  parseCallHistory,
  restBaseUrl,
} from '../src/callHistory.js';
import { NullMedia } from './nullMedia.js';

/** 通话记录：地址推导、请求拼装、分页「到底」判据、错误映射、未登录 / 销毁后的门。 */

function body(count: number, next?: number): unknown {
  return {
    calls: Array.from({ length: count }, (_, i) => ({
      call_id: `c${i}`, caller: 'alice', media_type: 'video', is_group: false, reason: 'hangup',
      duration_sec: 12, started_at_ms: 1000 - i, members: [{ uid: 'bob', state: 'joined' }],
    })),
    ...(next === undefined ? {} : { next_cursor: next }),
  };
}

function codeOf(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: number }).code;
  }
  return undefined;
}

describe('restBaseUrl / callHistoryUrl', () => {
  it('信令地址推出 REST 根', () => {
    expect(restBaseUrl('ws://127.0.0.1:8787/v1/ws')).toBe('http://127.0.0.1:8787');
    expect(restBaseUrl('wss://rtc.example.com/v1/ws')).toBe('https://rtc.example.com');
    expect(restBaseUrl('wss://rtc.example.com/gw/v1/ws?x=1')).toBe('https://rtc.example.com/gw');
    expect(restBaseUrl('https://rtc.example.com/v1/ws')).toBe('https://rtc.example.com');
    expect(restBaseUrl('ftp://h/v1/ws')).toBeNull();
    expect(restBaseUrl('not a url')).toBeNull();
  });

  it('请求带 limit 与 cursor', () => {
    expect(callHistoryUrl('ws://h:8787/v1/ws', 20)).toBe('http://h:8787/v1/calls?limit=20');
    expect(callHistoryUrl('ws://h:8787/v1/ws', 20, 1700000000000)).toBe(
      'http://h:8787/v1/calls?limit=20&cursor=1700000000000',
    );
  });
});

describe('parseCallHistory', () => {
  it('满页交出游标，不满页就是到底', () => {
    const full = parseCallHistory(200, body(2, 999), 2);
    expect(full.records).toHaveLength(2);
    expect(full.nextCursor).toBe(999);
    expect(full.records[0]).toMatchObject({ callId: 'c0', durationSec: 12, mediaType: 'video' });
    expect(full.records[0]?.members).toEqual([{ uid: 'bob', state: 'joined' }]);

    expect(parseCallHistory(200, body(1, 999), 2).nextCursor).toBeNull();
    const empty = parseCallHistory(200, { calls: [] }, 2);
    expect(empty.records).toHaveLength(0);
    expect(empty.nextCursor).toBeNull();
  });

  it('缺字段解成零值', () => {
    const page = parseCallHistory(200, { calls: [{ call_id: 'c1' }] }, 20);
    expect(page.records[0]).toMatchObject({ callId: 'c1', reason: '', durationSec: 0, members: [] });
  });

  it('状态码映射到错误码', () => {
    expect(codeOf(() => parseCallHistory(401, null, 20))).toBe(1101);
    expect(codeOf(() => parseCallHistory(500, null, 20))).toBe(1501);
    expect(codeOf(() => parseCallHistory(200, 'nope', 20))).toBe(1501);
  });
});

describe('fetchCallHistory', () => {
  it('带 Bearer、夹住 limit，网络错误映射成 2003', async () => {
    let seen: { url: string; auth: string } | undefined;
    const ok = (async (url: string, init?: RequestInit) => {
      seen = { url, auth: (init?.headers as Record<string, string>)['Authorization'] ?? '' };
      return new Response(JSON.stringify(body(1)), { status: 200 });
    }) as unknown as typeof fetch;
    const page = await fetchCallHistory('ws://h:8787/v1/ws', 'tok', { limit: 9999 }, ok);
    expect(seen).toEqual({ url: 'http://h:8787/v1/calls?limit=200', auth: 'Bearer tok' });
    expect(page.records).toHaveLength(1);

    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(fetchCallHistory('ws://h/v1/ws', 'tok', {}, down)).rejects.toMatchObject({ code: 2003 });
  });
});

describe('CallEngine.fetchCallHistory', () => {
  const make = (): CallEngine => new CallEngine({ url: 'ws://h/v1/ws', deviceId: 'd1', media: new NullMedia() });

  it('没登录 reject 2007', async () => {
    await expect(make().fetchCallHistory()).rejects.toMatchObject({ code: 2007 });
  });

  it('销毁后 reject 2005', async () => {
    const engine = make();
    engine.destroy();
    await expect(engine.fetchCallHistory()).rejects.toMatchObject({ code: 2005 });
  });
});
