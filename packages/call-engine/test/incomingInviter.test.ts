import { describe, expect, it } from 'vitest';

import { decodeEnvelope } from '../src/signaling/envelope.js';
import { decodeFrame } from '../src/signaling/registry.js';

/**
 * 帧解码只认字段表里列出的字段。`call.incoming.inviter` 曾漏在表外：服务端发来的值被解码丢掉，
 * 引擎回落成 caller，群通话里被别人加进来的人看到的永远是发起人（2026-09-20 联测：
 * Android / iOS 的成员加人，Web 被叫的来电提示都显示成发起人）。
 * 状态机测试直接喂已解码的数据，绕过了这一层，所以要从原始帧走一遍。
 */
describe('call.incoming 的 inviter 必须穿过帧解码', () => {
  const raw = (extra: Record<string, unknown>): string => JSON.stringify({
    type: 'call.incoming', req_id: '', ts: 1,
    data: { call_id: 'c1', room_id: 'r1', caller: 'alice', callee_ids: ['bob', 'carol'], media_type: 'video', is_group: true, ...extra },
  });

  it('加人进来：inviter 是加他的人，不是发起人', () => {
    const data = decodeFrame(decodeEnvelope(raw({ inviter: 'bob' })));
    expect(data.caller).toBe('alice');
    expect(data.inviter).toBe('bob');
  });

  it('旧服务端不带 inviter：解出空串（引擎回落 caller）', () => {
    const data = decodeFrame(decodeEnvelope(raw({})));
    expect(data.inviter ?? '').toBe('');
  });

  it('joined_ids（已在通话里的人）同样穿过解码；旧服务端不带则为空', () => {
    expect(decodeFrame(decodeEnvelope(raw({ joined_ids: ['alice', 'bob'] }))).joinedIds).toEqual(['alice', 'bob']);
    expect(decodeFrame(decodeEnvelope(raw({}))).joinedIds ?? []).toEqual([]);
  });
});
