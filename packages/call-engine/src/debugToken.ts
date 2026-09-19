import { byteLength } from './bytes.js';
import { ErrorCode, RtcError } from './errors.js';
import { logger } from './logger.js';

/**
 * 调试密钥本地签票（设计稿 `im-rtc-server/docs/design/DEBUG_KEY_DESIGN.md` §4）。
 *
 * **仅联调用**：把调试密钥放进客户端，等于把签票权交给所有拿到包的人。
 * 上线必须换成宿主后端 `POST /v1/tokens`。服务端只认 kid 以 `dbg-` 开头的调试密钥。
 * 向量：`im-rtc-server/docs/conformance/debug_token.json`。
 */

/** DebugTokenParams 是本地签票的入参。 */
export interface DebugTokenParams {
  readonly appId: string;
  /** 调试密钥 id，必须以 `dbg-` 开头。 */
  readonly keyId: string;
  readonly secret: string;
  readonly uid: string;
  readonly deviceId?: string;
  /** 有效期（秒）。缺省或 0 = 12h，钳到 [60, 2592000]（30 天）。 */
  readonly ttlSec?: number;
  /** 注入当前时间（Unix 毫秒），测试用；缺省 `Date.now()`。 */
  readonly nowMs?: number;
}

const DEFAULT_TTL_SEC = 12 * 3600;
const MIN_TTL_SEC = 60;
const MAX_TTL_SEC = 30 * 24 * 3600;
const MAX_UID_BYTES = 64;
const ISSUER = 'im-rtc-server';

const encoder = new TextEncoder();

/** base64url 无填充。 */
function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** hmacSha256B64url 返回 base64url(HMAC-SHA256(secret, input))，无填充。 */
export async function hmacSha256B64url(secret: string, input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    // 非安全上下文（http 非 localhost）没有 crypto.subtle。
    throw new RtcError(ErrorCode.internal, { cause: new Error('crypto.subtle 不可用（需 HTTPS 或 localhost）') });
  }
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64url(new Uint8Array(await subtle.sign('HMAC', key, encoder.encode(input))));
}

function validate(p: DebugTokenParams): void {
  const bad = (why: string): never => {
    throw new RtcError(ErrorCode.badParams, { forType: `generateDebugToken: ${why}` });
  };
  if (p.appId === '') bad('appId 为空');
  if (p.secret === '') bad('secret 为空');
  if (!p.keyId.startsWith('dbg-')) bad('keyId 必须以 dbg- 开头（不要把生产密钥放进客户端）');
  if (p.uid === '') bad('uid 为空');
  if (/\s/u.test(p.uid)) bad('uid 含空白');
  if (byteLength(p.uid) > MAX_UID_BYTES) bad(`uid 超过 ${MAX_UID_BYTES} 字节`);
}

function clampTtl(ttlSec: number | undefined): number {
  if (ttlSec === undefined || ttlSec === 0 || !Number.isFinite(ttlSec)) return DEFAULT_TTL_SEC;
  return Math.min(MAX_TTL_SEC, Math.max(MIN_TTL_SEC, Math.floor(ttlSec)));
}

/**
 * generateDebugToken 在本地用调试密钥签一张 HS256 JWT。**仅联调，上线换后端 `/v1/tokens`。**
 *
 * 入参不合法抛 `RtcError(1004)`。
 */
export async function generateDebugToken(params: DebugTokenParams): Promise<string> {
  validate(params);
  // 走 logger（默认 sink 即 console.warn；仓库禁止业务代码直接用 console）。
  logger.warn('【仅联调】正在用调试密钥在客户端本地签票——上线必须换成后端 /v1/tokens，勿把密钥带进正式包');

  const iat = Math.floor((params.nowMs ?? Date.now()) / 1000);
  const claims: Record<string, string | number> = {
    iss: ISSUER,
    sub: params.uid,
    aud: params.appId,
    exp: iat + clampTtl(params.ttlSec),
    iat,
    scope: 'access',
  };
  if (params.deviceId !== undefined && params.deviceId !== '') claims['did'] = params.deviceId;

  const header = { alg: 'HS256', typ: 'JWT', kid: params.keyId };
  const signingInput = `${b64url(encoder.encode(JSON.stringify(header)))}.${b64url(encoder.encode(JSON.stringify(claims)))}`;
  return `${signingInput}.${await hmacSha256B64url(params.secret, signingInput)}`;
}
