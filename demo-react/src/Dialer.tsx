import { useCall } from '@im-rtc/call-uikit-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { createMeetingRoom, fetchRoomToken } from './api.js';
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
  const { state, actions } = useCall();
  const [callee, setCallee] = useState('bob');
  const [picked, setPicked] = useState<readonly string[]>(['bob', 'carol']);
  const [roomId, setRoomId] = useState('');
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

      <div className="row" style={{ marginBottom: 12 }}>
        <div>
          <label htmlFor="callee">1v1 对方 uid</label>
          <input id="callee" value={callee} onChange={(e) => setCallee(e.target.value)} />
        </div>
        <button type="button" className="ghost" disabled={busy}
          onClick={guard(() => actions.placeCall([callee.trim()], 'audio'))}>语音呼叫</button>
        <button type="button" disabled={busy}
          onClick={guard(() => actions.placeCall([callee.trim()], 'video'))}>视频呼叫</button>
      </div>

      {/*
        **群呼是勾名字，不是手打逗号分隔的 uid**（与 iOS / Android Demo 对齐——
        本仓在这一条上一直是 🟡，见 CLIENT_PARITY「群呼选人」那一行）。

        手打有两个一眼看不出的坑：把自己也写进名单里，服务端会以 `1004` 拒掉**整通**电话，
        而界面上只看到「呼叫失败」；名字打错一个字母，那个人就成了一个永远接不起来的占位格。
        勾选把两个都消掉了——自己压根不在候选里（`calleesFor`），名字也不可能打错。
      */}
      <div style={{ marginBottom: 12 }}>
        <label>多人通话 · 已选 {callees.length} / {GROUP_PICK_LIMIT}</label>
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
        <button type="button" disabled={busy || callees.length === 0}
          onClick={guard(() => actions.placeCall(callees, 'video', true))}>群视频呼叫</button>
      </div>

      <div className="row">
        <div>
          <label htmlFor="room">会议房间号</label>
          <input id="room" value={roomId} onChange={(e) => setRoomId(e.target.value)}
            placeholder="把别人给的房间号粘进来" />
        </div>
        <button type="button" className="ghost" disabled={busy || roomId.trim() === ''}
          onClick={guard(joinMeeting)} data-testid="join-meeting">
          加入
        </button>
        <button type="button" disabled={busy}
          onClick={guard(createMeeting)} data-testid="create-meeting">
          新建会议
        </button>
      </div>

      {error !== '' && <div className="note" style={{ color: '#e5484d' }}>{error}</div>}
      <div className="note">
        会议不走振铃，直接进房——同一个 Room 原语的另一种玩法。
        新建后把房间号发给另一个标签页，那边点「加入」就能双开。
        <b>最后一个人离开后房间即销毁</b>，所以旧房间号再「加入」会得到「房间不存在」。
      </div>
    </div>
  );
}
