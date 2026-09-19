import { ErrorCode, RtcError } from './errors.js';

/*
 * 通话记录查询：`GET /v1/calls`（server 设计文档 §4.5）。
 *
 * **宿主不一定要用它**：很多宿主拿 `callEnd` 事件自己存、或拿 webhook 落自己的库就够了。
 * 想让「换设备、清缓存之后记录还在」，或者不想自己存，就调 `CallEngine.fetchCallHistory`。
 *
 * 走的是当前登录用的那枚接入票（含 `updateToken` 换过的），服务端据此**只返回本人参与过的通话**——
 * 所以没有 `uid` 参数，也不能查别人。
 */

/** 通话记录里的一位成员。`state` 是这位成员在这通电话里的结局，原样透传。 */
export interface CallHistoryMember {
  readonly uid: string;
  readonly state: string;
}

/**
 * 一条通话记录，字段与服务端 `GET /v1/calls` 一一对应（camelCase）。
 *
 * `reason` 是通话的最终结局（`hangup` / `cancel` / `reject` / `no_answer`…），**不分角色**：
 * 要显示「已取消」还是「对方已取消」，用 `caller` 与自己的 `uid` 比出角色再定文案。
 */
export interface CallHistoryRecord {
  readonly callId: string;
  readonly roomId: string;
  readonly caller: string;
  /** `audio` 或 `video`。 */
  readonly mediaType: string;
  readonly isGroup: boolean;
  readonly reason: string;
  readonly endedBy: string;
  readonly durationSec: number;
  readonly startedAtMs: number;
  readonly connectedAtMs: number;
  readonly endedAtMs: number;
  readonly userData: string;
  readonly chatGroupId: string;
  readonly members: readonly CallHistoryMember[];
}

/** 一页通话记录（按发起时间倒序）。`nextCursor` 为 `null` 表示已经到底。 */
export interface CallHistoryPage {
  readonly records: readonly CallHistoryRecord[];
  readonly nextCursor: number | null;
}

export interface FetchCallHistoryOptions {
  /** 每页条数，夹在 1..200，默认 20。 */
  readonly limit?: number;
  /** 首页不传；下一页传上一页的 `nextCursor`。 */
  readonly cursor?: number;
}

/** 服务端每页上限（`maxCallLimit`）。超过它服务端也只回这么多，「到底」的判据就不成立了，所以本地先夹住。 */
export const MAX_CALL_HISTORY_LIMIT = 200;
export const DEFAULT_CALL_HISTORY_LIMIT = 20;

/** 信令地址推出 REST 根：`ws→http`、`wss→https`，去掉末尾的 `/v1/ws`。推不出返回 `null`。 */
export function restBaseUrl(signalingUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(signalingUrl);
  } catch {
    return null;
  }
  const scheme = { 'ws:': 'http:', 'wss:': 'https:', 'http:': 'http:', 'https:': 'https:' }[url.protocol];
  if (scheme === undefined) return null;
  const path = url.pathname.endsWith('/v1/ws') ? url.pathname.slice(0, -'/v1/ws'.length) : url.pathname;
  return `${scheme}//${url.host}${path.replace(/\/$/, '')}`;
}

export function callHistoryUrl(signalingUrl: string, limit: number, cursor?: number): string | null {
  const base = restBaseUrl(signalingUrl);
  if (base === null) return null;
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor !== undefined && cursor > 0) query.set('cursor', String(cursor));
  return `${base}/v1/calls?${query.toString()}`;
}

function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return typeof v === 'string' ? v : '';
}

function num(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toRecord(o: Record<string, unknown>): CallHistoryRecord {
  const members = Array.isArray(o['members']) ? o['members'].filter(isObject) : [];
  return {
    callId: str(o, 'call_id'),
    roomId: str(o, 'room_id'),
    caller: str(o, 'caller'),
    mediaType: str(o, 'media_type'),
    isGroup: o['is_group'] === true,
    reason: str(o, 'reason'),
    endedBy: str(o, 'ended_by'),
    durationSec: num(o, 'duration_sec'),
    startedAtMs: num(o, 'started_at_ms'),
    connectedAtMs: num(o, 'connected_at_ms'),
    endedAtMs: num(o, 'ended_at_ms'),
    userData: str(o, 'user_data'),
    chatGroupId: str(o, 'chat_group_id'),
    members: members.map((m) => ({ uid: str(m, 'uid'), state: str(m, 'state') })),
  };
}

/** 状态码与应答体 → 一页记录；出错抛 `RtcError`。 */
export function parseCallHistory(status: number, body: unknown, limit: number): CallHistoryPage {
  if (status === 401) {
    throw new RtcError(ErrorCode.tokenInvalid, { cause: new Error('查通话记录被拒（401）：票无效或已过期') });
  }
  if (status !== 200) {
    throw new RtcError(ErrorCode.internal, { cause: new Error(`查通话记录失败：HTTP ${status}`) });
  }
  if (!isObject(body)) {
    throw new RtcError(ErrorCode.internal, { cause: new Error('通话记录应答不是对象') });
  }
  const calls = Array.isArray(body['calls']) ? body['calls'].filter(isObject) : [];
  const records = calls.map(toRecord);
  const next = typeof body['next_cursor'] === 'number' ? body['next_cursor'] : null;
  // 服务端只要这页有数据就给 next_cursor，没有「到底」标志：
  // 不满一页就一定是最后一页，满页才交出游标（最坏多翻一页空的）。
  return { records, nextCursor: records.length >= limit ? next : null };
}

/** 发请求并解析。`fetchImpl` 可注入，单测不碰网络。 */
export async function fetchCallHistory(
  signalingUrl: string,
  token: string,
  options: FetchCallHistoryOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<CallHistoryPage> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_CALL_HISTORY_LIMIT), 1), MAX_CALL_HISTORY_LIMIT);
  const url = callHistoryUrl(signalingUrl, limit, options.cursor);
  if (url === null) {
    throw new RtcError(ErrorCode.badParams, { cause: new Error(`信令地址无法推出 REST 地址：${signalingUrl}`) });
  }
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    throw new RtcError(ErrorCode.networkUnreachable, { cause: err });
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // 非 JSON：交给 parseCallHistory 按状态码报错。
  }
  return parseCallHistory(response.status, body, limit);
}
