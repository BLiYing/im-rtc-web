/**
 * Demo 用到的 REST 调用。
 *
 * **这一层不是 SDK 的一部分**——它示范的是「宿主后台该做的事」：
 * 用自己的账号体系换 token、用自己的接口建房、要不要查通话记录也由宿主自己定。
 */

async function request<T>(url: string, init: RequestInit, bearer?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer !== undefined) headers['Authorization'] = `Bearer ${bearer}`;
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) throw new Error(`${url} 返回 ${response.status}`);
  return (await response.json()) as T;
}

/** demoLogin 走服务端的免密登录（仅 -demo-login 下存在）。 */
export async function demoLogin(server: string, username: string): Promise<string> {
  const out = await request<{ token: string }>(
    `${server}/v1/demo/login`, { method: 'POST', body: JSON.stringify({ username }) });
  return out.token;
}

/** createMeetingRoom 建一个会议房。 */
export async function createMeetingRoom(server: string, token: string): Promise<string> {
  const out = await request<{ room_id: string }>(
    `${server}/v1/rooms`, { method: 'POST', body: JSON.stringify({ kind: 'meeting' }) }, token);
  return out.room_id;
}

/** fetchRoomToken 给自己换一枚进房票。 */
export async function fetchRoomToken(
  server: string, token: string, roomId: string, deviceId: string,
): Promise<string> {
  const out = await request<{ room_token: string }>(
    `${server}/v1/rooms/${roomId}/tokens`,
    { method: 'POST', body: JSON.stringify({ device_id: deviceId }) }, token);
  return out.room_token;
}

/** CallRecord 是一条通话记录（服务端 §4.5 的 REST 出口）。 */
export interface CallRecord {
  readonly call_id: string;
  readonly caller: string;
  readonly media_type: string;
  readonly is_group: boolean;
  readonly reason: string;
  readonly ended_by: string;
  readonly duration_sec: number;
  readonly started_at_ms: number;
  readonly members: readonly { uid: string; state: string }[];
}

/**
 * listCalls 查通话记录。
 *
 * **宿主不一定要用它**：很多宿主拿 webhook 落自己的库就够了。
 * 这里查它只是为了让 Demo 能把「一通电话结束之后留下了什么」展示出来。
 */
export async function listCalls(
  server: string, token: string, uid: string, signal: AbortSignal,
): Promise<CallRecord[]> {
  const out = await request<{ calls: CallRecord[] }>(
    `${server}/v1/calls?uid=${encodeURIComponent(uid)}&limit=20`, { method: 'GET', signal }, token);
  return out.calls;
}
