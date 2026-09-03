/**
 * Demo 用到的 REST 调用。
 *
 * **这一层不是 SDK 的一部分**——它是「宿主后台该做的事」的示范。
 * 真实宿主会用自己的账号体系换 token，用自己的接口建房。
 */

/**
 * postJson 发一个 POST。
 *
 * **失败时要把服务端说的话带出来**：它回的是 `{"error":"房间不存在"}`，
 * 只报一个 `返回 404` 等于把已经到手的答案扔掉——排查时还得自己去翻服务端日志。
 * （实测踩过：会议房空了就销毁，再拿旧房间号进会议只看到「返回 404」，
 * 看不出到底是房间没了还是路由写错了。）
 */
async function postJson<T>(url: string, body: unknown, bearer?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer !== undefined) headers['Authorization'] = `Bearer ${bearer}`;

  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) {
    throw new Error(`${url} 返回 ${response.status}：${await errorText(response)}`);
  }
  return (await response.json()) as T;
}

/** errorText 取服务端的 error 字段；取不到就退回原始正文（截断）。 */
async function errorText(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error !== '') return parsed.error;
  } catch {
    // 不是 JSON：原样给一小段，比什么都不说好。
  }
  return body.slice(0, 200) || '（无正文）';
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
