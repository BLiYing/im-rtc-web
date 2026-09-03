/**
 * Demo 用到的 REST 调用。
 *
 * **这一层不是 SDK 的一部分**——它是「宿主后台该做的事」的示范。
 * 真实宿主会用自己的账号体系换 token，用自己的接口建房。
 */

async function postJson<T>(url: string, body: unknown, bearer?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer !== undefined) headers['Authorization'] = `Bearer ${bearer}`;

  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) {
    throw new Error(`${url} 返回 ${response.status}`);
  }
  return (await response.json()) as T;
}

/** demoLogin 走服务端的免密登录（仅 -demo-login 下存在）。 */
export async function demoLogin(server: string, username: string): Promise<string> {
  const out = await postJson<{ token: string }>(`${server}/v1/demo/login`, { username });
  return out.token;
}

/** createMeetingRoom 建一个会议房。 */
export async function createMeetingRoom(server: string, token: string): Promise<string> {
  const out = await postJson<{ room_id: string }>(`${server}/v1/rooms`, { kind: 'meeting' }, token);
  return out.room_id;
}

/** fetchRoomToken 给自己换一枚进房票。 */
export async function fetchRoomToken(
  server: string,
  token: string,
  roomId: string,
  deviceId: string,
): Promise<string> {
  const out = await postJson<{ room_token: string }>(
    `${server}/v1/rooms/${roomId}/tokens`,
    { device_id: deviceId },
    token,
  );
  return out.room_token;
}
