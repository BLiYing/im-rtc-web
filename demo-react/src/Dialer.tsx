import { useCall } from 'im-rtc-call-uikit-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { createMeetingRoom, fetchRoomToken } from '@demo/api';
import { DEMO_CONTACTS, GROUP_PICK_LIMIT, calleesFor } from './contacts.js';

/** DialerProps 是拨号面板的参数。 */
export interface DialerProps {
  readonly server: string;
  readonly token: string;
  readonly deviceId: string;
  /** 当前登录的 uid。**群呼名单要把自己剔掉**，见 `calleesFor`。 */
  readonly uid: string;
}

/**
 * 拨号面板：1v1、群呼、进会议。
 *
 * **这一整个面板都是宿主代码**——联系人从哪来、群怎么组织，SDK 一概不管
 * （CONVENTIONS §11）。它只调 `actions.placeCall` 与 `actions.joinMeeting`。
 */
export function Dialer({ server, token, deviceId, uid }: DialerProps): ReactNode {
  const { state, actions, joinCall } = useCall();
  const [callee, setCallee] = useState('bob');
  const [picked, setPicked] = useState<readonly string[]>(['bob', 'carol']);
  const [roomId, setRoomId] = useState('');
  const [callId, setCallId] = useState('');
  const [error, setError] = useState('');
  const busy = state.phase !== 'idle';
  // 自己不在候选里：带着自己发出去，服务端会以 1004 拒掉**整通**电话。
  const contacts = DEMO_CONTACTS.filter((c) => c.uid !== uid);
  const callees = calleesFor(uid, picked);
  const atLimit = callees.length >= GROUP_PICK_LIMIT;

  const toggle = (id: string): void => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const guard = (run: () => Promise<unknown>) => (): void => {
    setError('');
    void run().catch((err: unknown) => setError(String(err)));
  };

  /*
    **「新建」与「加入」分成两个按钮**，不再由一个「进会议」按输入框空不空自己猜。

    猜错的代价实测撞到过：会议房**空了就销毁**（最后一个人离开即关），
    而输入框里还留着刚离开的那个房间号——想新建一个，点下去却是去加入一个
    已经不存在的房间，只看到一句 404。房间号留在框里是有用的（要发给另一个标签页），
    所以留着框、把动作拆开，比清空框更对。
  */
  const enter = async (id: string): Promise<void> => {
    setRoomId(id);
    const roomToken = await fetchRoomToken(server, token, id, deviceId);
    await actions.joinMeeting(id, roomToken);
  };

  const createMeeting = async (): Promise<void> => enter(await createMeetingRoom(server, token));
  const joinMeeting = async (): Promise<void> => enter(roomId.trim());

  return (
    <div className="card">
      <h2>拨号</h2>

      <div className="dial-section">
        <label className="dial-title" htmlFor="callee">1v1 通话</label>
        <div className="dial-row">
          <input id="callee" className="dial-field" value={callee} onChange={(e) => setCallee(e.target.value)}
            placeholder="对方 uid" />
          <div className="dial-actions">
            <button type="button" className="ghost" disabled={busy}
              onClick={guard(() => actions.placeCall([callee.trim()], 'audio'))}>语音呼叫</button>
            <button type="button" disabled={busy}
              onClick={guard(() => actions.placeCall([callee.trim()], 'video'))}>视频呼叫</button>
          </div>
        </div>
      </div>

      {/*
        **群呼是勾名字，不是手打逗号分隔的 uid**（与 iOS / Android Demo 对齐——
        本仓在这一条上一直是 🟡，见 CLIENT_PARITY「群呼选人」那一行）。

        手打有两个一眼看不出的坑：把自己也写进名单里，服务端会以 `1004` 拒掉**整通**电话，
        而界面上只看到「呼叫失败」；名字打错一个字母，那个人就成了一个永远接不起来的占位格。
        勾选把两个都消掉了——自己压根不在候选里（`calleesFor`），名字也不可能打错。
      */}
      <div className="dial-section">
        <div className="dial-title">
          多人通话<span className="muted">已选 {callees.length} / {GROUP_PICK_LIMIT}</span>
        </div>
        <div className="dial-row top">
          <div className="dial-field">
            <div className="picks" data-testid="group-picks">
              {contacts.map((c) => {
                const on = callees.includes(c.uid);
                return (
                  <button key={c.uid} type="button" className="pick" aria-pressed={on}
                    data-testid={`pick-${c.uid}`}
                    // 到上限就不让再勾——比勾上了再弹一句「最多 8 人」温和，标题上一直写着 8 / 8。
                    disabled={busy || (!on && atLimit)}
                    onClick={() => toggle(c.uid)}>{c.uid}</button>
                );
              })}
            </div>
          </div>
          {/*
            群呼带上一个 `chatGroupId`（HOST_INTEGRATION_DESIGN §3.2）：Demo 没有真的群，
            写死同一个值——被叫与中途 `joinCall()` 进来的人都能从这一通电话上拿到它，
            「添加成员」的 `InviteContext.chatGroupId` 也是它。
          */}
          <div className="dial-actions">
            <button type="button" disabled={busy || callees.length === 0}
              onClick={guard(() => actions.placeCall(callees, 'video', { isGroup: true, chatGroupId: DEMO_CHAT_GROUP_ID }))}>
              群视频呼叫
            </button>
          </div>
        </div>
      </div>

      <div className="dial-section">
        <label className="dial-title" htmlFor="room">会议</label>
        <div className="dial-row">
          <input id="room" className="dial-field" value={roomId} onChange={(e) => setRoomId(e.target.value)}
            placeholder="房间号" />
          <div className="dial-actions">
            <button type="button" className="ghost" disabled={busy || roomId.trim() === ''}
              onClick={guard(joinMeeting)} data-testid="join-meeting">
              加入
            </button>
            <button type="button" disabled={busy}
              onClick={guard(createMeeting)} data-testid="create-meeting">
              新建会议
            </button>
          </div>
        </div>
        <div className="dial-hint">
          会议不振铃，点进去就在房里。新建后把房间号发到另一个标签页，粘进来点「加入」即可双开。<br />
          最后一个人离开，房间就销毁了；旧房间号再加入会提示「房间不存在」，重新新建一个。
        </div>
      </div>

      {/*
        「按 call_id 主动加入」（协议 §4.1 `call.join`，HOST_INTEGRATION_DESIGN §3.4）。
        真实宿主靠 webhook `call.started` 或 `GET /v1/calls?chat_group_id=...&active=1`
        自己判断「有通话在进行中」再摆横幅；Demo 没有这套，就让人把另一个标签页
        打出的群通话 call_id 抄过来手动试——**这一个入口只给 Demo 用**，
        协议本身不管「怎么知道有通话在进行中」。
        call_id 只在 engine 事件流里看得到（`callBegin` 的 `callId`；通话记录表没有这一列）。
      */}
      <div className="dial-section">
        <label className="dial-title" htmlFor="join-call-id">加入进行中的群通话</label>
        <div className="dial-row">
          <input id="join-call-id" className="dial-field" value={callId} onChange={(e) => setCallId(e.target.value)}
            placeholder="call_id" />
          <div className="dial-actions">
            <button type="button" className="ghost" disabled={busy || callId.trim() === ''}
              onClick={guard(() => joinCall(callId.trim()))} data-testid="join-call">
              加入
            </button>
          </div>
        </div>
        <div className="dial-hint">在另一个标签页发起群通话，接通后从它页面底部「engine 事件流」的 <code>callBegin</code> 里复制 <code>callId</code>。</div>
      </div>

      {error !== '' && <div className="note" style={{ color: '#e5484d' }}>{error}</div>}
    </div>
  );
}

/** DEMO_CHAT_GROUP_ID 是 Demo 写死的群号（Demo 没有真的群系统）。 */
const DEMO_CHAT_GROUP_ID = 'demo-group';
