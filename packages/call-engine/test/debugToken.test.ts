import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDebugToken, hmacSha256B64url } from '../src/debugToken.js';
import { ErrorCode } from '../src/errors.js';
import { setLogSink } from '../src/logger.js';
import { loadVector } from './vectors.js';

interface Input {
  app_id: string;
  uid: string;
  device_id?: string;
  ttl_sec?: number;
}
interface DebugVector {
  hmac_cases: { name: string; secret: string; signing_input: string; expect_signature: string }[];
  sign_cases: {
    name: string;
    secret: string;
    key_id: string;
    now_unix: number;
    input: Input;
    expect_header: Record<string, unknown>;
    expect_claims: Record<string, unknown>;
  }[];
  reject_cases: { name: string; secret?: string; key_id?: string; input: Input }[];
}

const vec = loadVector<DebugVector>('debug_token.json');
const DEFAULT_SECRET = vec.sign_cases[0]?.secret ?? 'x';

const b64uJson = (s: string): unknown =>
  JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

function paramsOf(input: Input, keyId: string, secret: string, nowMs?: number) {
  return {
    appId: input.app_id,
    keyId,
    secret,
    uid: input.uid,
    ...(input.device_id !== undefined ? { deviceId: input.device_id } : {}),
    ...(input.ttl_sec !== undefined ? { ttlSec: input.ttl_sec } : {}),
    ...(nowMs !== undefined ? { nowMs } : {}),
  };
}

describe('generateDebugToken 一致性向量', () => {
  const sink = vi.fn();
  beforeEach(() => setLogSink(sink));
  afterEach(() => {
    setLogSink(null);
    sink.mockClear();
  });

  it.each(vec.hmac_cases)('hmac: $name', async (c) => {
    expect(await hmacSha256B64url(c.secret, c.signing_input)).toBe(c.expect_signature);
  });

  it.each(vec.sign_cases)('sign: $name', async (c) => {
    const token = await generateDebugToken(
      paramsOf(c.input, c.key_id, c.secret, c.now_unix * 1000),
    );
    const [h, p, sig] = token.split('.');
    expect(token.split('.')).toHaveLength(3);
    expect(b64uJson(h ?? '')).toEqual(c.expect_header);
    expect(b64uJson(p ?? '')).toEqual(c.expect_claims);
    expect(token).not.toMatch(/[=+/]/);
    const want = createHmac('sha256', c.secret).update(`${h}.${p}`).digest('base64url');
    expect(sig).toBe(want);
  });

  it.each(vec.reject_cases)('reject: $name', async (c) => {
    await expect(
      generateDebugToken(paramsOf(c.input, c.key_id ?? 'dbg-1', c.secret ?? DEFAULT_SECRET, 0)),
    ).rejects.toMatchObject({ code: ErrorCode.badParams });
  });

  it('每次调用都打「仅联调」警告', async () => {
    await generateDebugToken(paramsOf({ app_id: '1', uid: 'a' }, 'dbg-1', 's'));
    expect(sink).toHaveBeenCalledWith('warn', expect.stringContaining('仅联调'), expect.anything());
  });
});
