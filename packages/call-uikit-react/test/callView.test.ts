import { describe, expect, it } from 'vitest';

import type { CallViewState, ViewAction } from '../src/state/callView.js';
import {
  canShowInvite, defaultCameraOn, initialCallView, isCallVisible, reduceCallView, ringtoneFor,
} from '../src/state/callView.js';

/** run 把一串动作依次喂进去，返回终态。 */
function run(actions: ViewAction[], from: CallViewState = initialCallView): CallViewState {
  return actions.reduce(reduceCallView, from);
}

const incoming: ViewAction = {
  type: 'callReceived', callId: 'c-1', caller: 'alice', calleeIds: [], mediaType: 'video', isGroup: false,
};
const begin: ViewAction = {
  type: 'callBegin', callId: 'c-1', roomId: 'r-1', mediaType: 'video',
  isGroup: false, role: 'callee', nowMs: 1_000,
};

describe('加人入口', () => {
  it('被叫侧记下发起人；响铃中没有入口，接通后才有（通话里的人都能加）', () => {
    let state = run([{
      type: 'callReceived', callId: 'c-1', caller: 'alice', calleeIds: ['carol'], mediaType: 'video', isGroup: true,
    }]);
    expect(state.callerUid).toBe('alice');
    expect(canShowInvite(state)).toBe(false);

    state = reduceCallView(state, {
      type: 'callBegin', callId: 'c-1', roomId: 'r-1', mediaType: 'video', isGroup: true, role: 'callee', nowMs: 1_000,
    });
    expect(state.callerUid).toBe('alice');
    expect(canShowInvite(state)).toBe(true);

    // 自己拨出的下一通不带上一通的发起人。
    expect(reduceCallView(state, { type: 'callPlaced', calleeIds: ['bob'], mediaType: 'audio', isGroup: true }).callerUid)
      .toBe('');
  });
});

describe('通话界面的阶段', () => {
  it('来电 → 接通中 → 通话中 → 结束 → 收起', () => {
    let state = run([incoming]);
    expect(state.phase).toBe('incoming');
    expect(state.peerUid).toBe('alice');

    state = reduceCallView(state, begin);
    // callBegin 只说「通话建立」，媒体不一定通了——所以先是 connecting。
    expect(state.phase).toBe('connecting');
    expect(state.beganAtMs).toBe(1_000);

    state = reduceCallView(state, { type: 'mediaReady' });
    expect(state.phase).toBe('active');

    state = reduceCallView(state, { type: 'callEnd', reason: 'hangup' });
    expect(state.phase).toBe('ended');
    expect(state.endReason).toBe('hangup');

    state = reduceCallView(state, { type: 'dismiss' });
    expect(state).toEqual(initialCallView);
    expect(isCallVisible(state)).toBe(false);
  });

  it('mediaReady 在 connecting 之外不改阶段', () => {
    // 进房事件在通话之外也会来（会议场景），不能因此把 idle 变成 active。
    expect(reduceCallView(initialCallView, { type: 'mediaReady' }).phase).toBe('idle');
  });

  it('媒体先就绪、callBegin 后到，也要进通话中', () => {
    // 会议场景里进房成功几乎与 callBegin 同时发生，两个顺序都会出现。
    // 只认「阶段正好是 connecting」的话，先到的那个被丢掉，界面永远停在「接通中」。
    const state = run([
      { type: 'mediaReady' },
      { type: 'callBegin', callId: '', roomId: 'r-1', mediaType: 'video',
        isGroup: true, role: '', nowMs: 1 },
    ]);
    expect(state.phase).toBe('active');
  });

  it('呼出时对方先摆上去且标成未接听，界面才有「响铃中」的格子', () => {
    const state = run([
      { type: 'callPlaced', calleeIds: ['bob', 'carol'], mediaType: 'audio', isGroup: true },
    ]);
    expect(state.phase).toBe('outgoing');
    expect(state.participants.map((p) => [p.uid, p.hasAccepted])).toEqual([
      ['bob', false],
      ['carol', false],
    ]);
    expect(state.peerUid).toBe(''); // 群通话没有「对端」
  });

  it('结束是唯一出口：结束时要退出小窗，不然小窗会挂在那里', () => {
    const state = run([
      incoming, begin,
      { type: 'setMinimized', minimized: true },
      { type: 'callEnd', reason: 'hangup' },
    ]);
    expect(state.isMinimized).toBe(false);
  });
});

describe('成员状态的叠加', () => {
  it('默认认为对方有音频——userAudioAvailable 只在变化时才抛', () => {
    // 默认 false 的话，一个从头到尾正常说话的人会一直显示成静音。
    const state = run([incoming]);
    expect(state.participants[0]?.hasAudio).toBe(true);
    expect(state.participants[0]?.hasVideo).toBe(false);
  });

  it('成员事件比进房通知先到时自动补人', () => {
    const state = run([
      incoming, begin,
      { type: 'userVideo', uid: 'dave', available: true },
    ]);
    expect(state.participants.map((p) => p.uid)).toEqual(['alice', 'dave']);
    expect(state.participants[1]?.hasVideo).toBe(true);
  });

  it('主讲人是全量快照：不在名单里的人要灭掉高亮', () => {
    let state = run([
      { type: 'callPlaced', calleeIds: ['bob', 'carol'], mediaType: 'audio', isGroup: true },
    ]);
    state = reduceCallView(state, {
      type: 'activeSpeakers', speakers: [{ uid: 'bob', volume: 60 }],
    });
    expect(state.participants.map((p) => p.isSpeaking)).toEqual([true, false]);

    // bob 不说话了：名单变空，高亮必须灭——只加不减的话会一直亮着。
    state = reduceCallView(state, { type: 'activeSpeakers', speakers: [] });
    expect(state.participants.map((p) => p.isSpeaking)).toEqual([false, false]);
    expect(state.participants[0]?.volume).toBe(0);
  });

  it('网络质量只更新报上来的人，没报的保持原样', () => {
    let state = run([
      { type: 'callPlaced', calleeIds: ['bob', 'carol'], mediaType: 'audio', isGroup: true },
      { type: 'networkQuality', entries: [{ uid: 'bob', level: 5 }, { uid: 'carol', level: 2 }] },
    ]);
    state = reduceCallView(state, { type: 'networkQuality', entries: [{ uid: 'bob', level: 1 }] });
    expect(state.participants.map((p) => p.networkLevel)).toEqual([1, 2]);
  });

  it('离开的人从列表里摘掉', () => {
    const state = run([
      { type: 'callPlaced', calleeIds: ['bob', 'carol'], mediaType: 'audio', isGroup: true },
      { type: 'userLeave', uid: 'bob' },
    ]);
    expect(state.participants.map((p) => p.uid)).toEqual(['carol']);
  });
});

describe('本端开关', () => {
  it('视频通话默认开摄像头、语音通话默认不开', () => {
    expect(run([incoming]).self.cameraOn).toBe(true);
    expect(
      run([{ type: 'callReceived', callId: 'c', caller: 'a', calleeIds: [], mediaType: 'audio', isGroup: false }])
        .self.cameraOn,
    ).toBe(false);
  });

  it('静音与关摄像头互不影响', () => {
    const state = run([incoming, { type: 'setMic', on: false }]);
    expect(state.self).toEqual({
      micOn: false, cameraOn: true, cameraBlocked: false, cameraOptedOut: false, speaking: false, volume: 0,
    });
  });

  it('群通话默认关摄像头，1v1 视频照旧默认开，会议房仍是开', () => {
    // 拨出与来电走同一个判据——只改一条的话，群视频来电页上那颗按钮会显示成已开启。
    expect(defaultCameraOn('video', false)).toBe(true);
    expect(defaultCameraOn('video', true)).toBe(false);
    expect(defaultCameraOn('audio', false)).toBe(false);
    const groupIn = run([{ ...incoming, isGroup: true, calleeIds: ['carol'] }]);
    expect(groupIn.self.cameraOn).toBe(false);
    expect(groupIn.self.cameraOptedOut, '默认关不是用户的选择').toBe(false);
    expect(run([{ type: 'callPlaced', calleeIds: ['bob', 'carol'], mediaType: 'video', isGroup: true }]).self.cameraOn)
      .toBe(false);
    expect(run([{ type: 'callPlaced', calleeIds: ['bob'], mediaType: 'video', isGroup: false }]).self.cameraOn)
      .toBe(true);
    expect(run([{ type: 'meetingJoined', roomId: 'r-1', nowMs: 0 }]).self.cameraOn).toBe(true);
  });

  it('只有来电页上亲手关掉摄像头才算「以语音接听」', () => {
    expect(run([incoming, { type: 'setCamera', on: false }]).self.cameraOptedOut).toBe(true);
    // 关了又打开：不再算。
    expect(run([incoming, { type: 'setCamera', on: false }, { type: 'setCamera', on: true }]).self.cameraOptedOut)
      .toBe(false);
    // 接通之后的开关与接听时要不要问权限无关。
    expect(run([incoming, begin, { type: 'setCamera', on: false }]).self.cameraOptedOut).toBe(false);
  });
});

/*
  群通话里有人拒接 / 没接，**格子要收掉**。

  不收的话那一格一直挂着「（响铃中）」——从主叫的角度看，
  对方拒接就跟什么都没发生一样。群通话里没有便利事件（不变量 I7），
  `userReject` / `userNoResponse` 是唯一的信号。
*/
describe('群通话里的终局裁决', () => {
  it('拒接的人先在格子上写明「已拒绝」，收掉是第二步', () => {
    const settled = run([
      { type: 'callPlaced', calleeIds: ['bob', 'carol'], mediaType: 'video', isGroup: true },
      { type: 'userSettled', uid: 'bob', outcome: 'rejected' },
    ]);
    // **先标不删**：直接消失的话，从主叫的角度看拒接就跟没发生过一样（交互稿 §05 G3）。
    expect(settled.participants.map((p) => [p.uid, p.settled])).toEqual([['bob', 'rejected'], ['carol', '']]);

    const removed = run([{ type: 'userRemove', uid: 'bob' }], settled);
    expect(removed.participants.map((p) => p.uid)).toEqual(['carol']);
  });

  it('已接听的人收到终局不受影响', () => {
    const state = run([
      { type: 'callPlaced', calleeIds: ['bob'], mediaType: 'video', isGroup: true },
      { type: 'userAccept', uid: 'bob' },
      { type: 'userSettled', uid: 'bob', outcome: 'no_answer' },
    ]);
    expect(state.participants[0]?.settled).toBe('');
  });
});

/*
  协议 2026-09-17 起 call.ringing 发给通话里的所有人：别人加的人也要摆占位格，
  否则 C 只会凭空收到「B 没接听」，还会再邀请一次正在响铃的 B。
*/
describe('userRinging：别人加的人也摆占位格', () => {
  const inGroup: ViewAction[] = [
    { type: 'callReceived', callId: 'c-1', caller: 'alice', calleeIds: ['carol'], mediaType: 'video', isGroup: true },
    { type: 'callBegin', callId: 'c-1', roomId: 'r-1', mediaType: 'video', isGroup: true, role: 'callee', nowMs: 0 },
    { type: 'userAccept', uid: 'alice' },
  ];

  it('群通话里某人开始响铃：摆一个没接听的占位格，接听后转正', () => {
    const ringing = run([...inGroup, { type: 'userRinging', uid: 'dave' }]);
    expect(ringing.participants.find((p) => p.uid === 'dave')?.hasAccepted).toBe(false);
    const accepted = run([{ type: 'userAccept', uid: 'dave' }], ringing);
    expect(accepted.participants.find((p) => p.uid === 'dave')?.hasAccepted).toBe(true);
  });

  it('不占 lastInvited：不是本端加的，1202 / 1407 收回时不该收它', () => {
    const state = run([...inGroup, { type: 'userRinging', uid: 'dave' }]);
    expect(state.lastInvited).toEqual([]);
  });

  it('重复的 userRinging 不重复摆；已接听的人不动', () => {
    const state = run([...inGroup, { type: 'userRinging', uid: 'dave' }, { type: 'userRinging', uid: 'dave' },
      { type: 'userRinging', uid: 'alice' }]);
    expect(state.participants.filter((p) => p.uid === 'dave')).toHaveLength(1);
    expect(state.participants.find((p) => p.uid === 'alice')?.hasAccepted).toBe(true);
  });

  it('标了终局还没收掉又被重新邀请：清掉终局', () => {
    const state = run([...inGroup, { type: 'userRinging', uid: 'dave' },
      { type: 'userSettled', uid: 'dave', outcome: 'rejected' }, { type: 'userRinging', uid: 'dave' }]);
    expect(state.participants.find((p) => p.uid === 'dave')?.settled).toBe('');
  });

  it('1v1 与来电页不摆（1v1 的对方本来就是大画面）', () => {
    const ringingPage = run([{ ...incoming, isGroup: true } as ViewAction]);
    expect(run([{ type: 'userRinging', uid: 'dave' }], ringingPage)).toBe(ringingPage);
    const oneToOne = run([{ type: 'callPlaced', calleeIds: ['bob'], mediaType: 'video', isGroup: false }]);
    expect(run([{ type: 'userRinging', uid: 'dave' }], oneToOne)).toBe(oneToOne);
  });
});

/*
  还在响铃的来电结束时**直接回 idle**，不留结束画面——
  否则来电浮层会当场变成通话页（那一排接通后才有的按钮全出来），停一两秒再消失。
*/
describe('来电的结束出口', () => {
  it('响铃中收到 callEnd 直接归零', () => {
    const state = run([incoming, { type: 'callEnd', reason: 'cancel' }]);
    expect(state.phase).toBe('idle');
  });

  it('已接通的通话仍然停在结束态，好让界面说清原因', () => {
    const state = run([
      incoming,
      { type: 'callBegin', callId: 'c', roomId: 'r', mediaType: 'video',
        isGroup: false, role: 'callee', nowMs: 0 },
      { type: 'callEnd', reason: 'hangup' },
    ]);
    expect(state.phase).toBe('ended');
    expect(state.endReason).toBe('hangup');
  });
});

describe('离场后被重新邀请回来的发起人', () => {
  it('来电的 caller 就是自己时不给自己摆格子', () => {
    const state = run([{
      type: 'callReceived', callId: 'c-1', caller: 'alice', selfUid: 'alice', calleeIds: ['bob', 'carol'],
      mediaType: 'video', isGroup: true,
    }]);
    expect(state.participants.map((p) => p.uid)).toEqual(['bob', 'carol']);
    expect(state.callerUid).toBe('alice');
  });
});

describe('来电显示「谁把你拉进来的」', () => {
  it('带 inviter 时记下它，caller 仍是发起人', () => {
    const state = run([{
      type: 'callReceived', callId: 'c-1', caller: 'alice', inviter: 'bob', calleeIds: ['carol'],
      mediaType: 'audio', isGroup: true, chatGroupId: '', userData: '',
    }]);
    expect(state.inviterUid).toBe('bob');
    expect(state.callerUid).toBe('alice');
  });

  it('旧服务端不带 inviter 时回落成 caller', () => {
    const state = run([{
      type: 'callReceived', callId: 'c-1', caller: 'alice', calleeIds: ['carol'],
      mediaType: 'audio', isGroup: true, chatGroupId: '', userData: '',
    }]);
    expect(state.inviterUid).toBe('alice');
  });
});

describe('ringtoneFor：此刻该响哪种提示音', () => {
  it('incoming 阶段响来电铃声', () => {
    const state: CallViewState = { ...initialCallView, phase: 'incoming' };
    expect(ringtoneFor(state, false)).toBe('incoming');
  });

  it('outgoing 阶段响回铃音', () => {
    const state: CallViewState = { ...initialCallView, phase: 'outgoing' };
    expect(ringtoneFor(state, false)).toBe('ringback');
  });

  it('会议房没有振铃，phase 恰好是 incoming/outgoing 也不响', () => {
    const state: CallViewState = { ...initialCallView, phase: 'incoming', isMeeting: true };
    expect(ringtoneFor(state, false)).toBe('none');
  });

  it('muted 时一律不响，哪怕正在来电/呼出', () => {
    const incomingState: CallViewState = { ...initialCallView, phase: 'incoming' };
    const outgoingState: CallViewState = { ...initialCallView, phase: 'outgoing' };
    expect(ringtoneFor(incomingState, true)).toBe('none');
    expect(ringtoneFor(outgoingState, true)).toBe('none');
  });

  it('其余阶段（接通中 / 通话中 / 结束 / 空闲）都不响', () => {
    for (const phase of ['idle', 'connecting', 'active', 'ended'] as const) {
      const state: CallViewState = { ...initialCallView, phase };
      expect(ringtoneFor(state, false)).toBe('none');
    }
  });

  it('来电展开页：已在通话里的人是正常格子，只有还在响铃的是占位格', () => {
    const state = reduceCallView(initialCallView, {
      type: 'callReceived', callId: 'c', caller: 'alice', inviter: 'bob', selfUid: 'dave',
      calleeIds: ['bob', 'carol'], joinedIds: ['alice', 'bob'], mediaType: 'audio', isGroup: true,
      chatGroupId: '', userData: '',
    });
    expect(Object.fromEntries(state.participants.map((p) => [p.uid, p.hasAccepted])))
      .toEqual({ alice: true, bob: true, carol: false });
    // 旧服务端不带 joined_ids：回落成只有发起人在通话里。
    const old = reduceCallView(initialCallView, {
      type: 'callReceived', callId: 'c', caller: 'alice', calleeIds: ['bob'], mediaType: 'audio', isGroup: true,
      chatGroupId: '', userData: '',
    });
    expect(old.participants.map((p) => p.hasAccepted)).toEqual([true, false]);
  });

  it('进房快照：响铃阶段离场的人格子要收掉，还在响铃的留着', () => {
    const ringing = reduceCallView(initialCallView, {
      type: 'callReceived', callId: 'c', caller: 'alice', calleeIds: ['bob', 'carol'], joinedIds: ['alice', 'bob'],
      mediaType: 'audio', isGroup: true, chatGroupId: '', userData: '',
    });
    const state = reduceCallView(ringing, { type: 'roomSnapshot', uids: ['alice'] });
    expect(state.participants.map((p) => p.uid)).toEqual(['alice', 'carol']);
  });
});
