import { describe, expect, it } from 'vitest';

import type { CallViewState, ViewAction } from '../src/state/callView.js';
import { initialCallView, isCallVisible, reduceCallView } from '../src/state/callView.js';

/** run 把一串动作依次喂进去，返回终态。 */
function run(actions: ViewAction[], from: CallViewState = initialCallView): CallViewState {
  return actions.reduce(reduceCallView, from);
}

const incoming: ViewAction = {
  type: 'callReceived', callId: 'c-1', caller: 'alice', mediaType: 'video', isGroup: false,
};
const begin: ViewAction = {
  type: 'callBegin', callId: 'c-1', roomId: 'r-1', mediaType: 'video',
  isGroup: false, role: 'callee', nowMs: 1_000,
};

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
      run([{ type: 'callReceived', callId: 'c', caller: 'a', mediaType: 'audio', isGroup: false }])
        .self.cameraOn,
    ).toBe(false);
  });

  it('静音与关摄像头互不影响', () => {
    const state = run([incoming, { type: 'setMic', on: false }]);
    expect(state.self).toEqual({ micOn: false, cameraOn: true });
  });
});

/*
  群通话里有人拒接 / 没接，**格子要收掉**。

  不收的话那一格一直挂着「（响铃中）」——从主叫的角度看，
  对方拒接就跟什么都没发生一样。群通话里没有便利事件（不变量 I7），
  `userReject` / `userNoResponse` 是唯一的信号。
*/
describe('群通话里的终局裁决', () => {
  it('拒接的人不再占着格子', () => {
    const state = run([
      { type: 'callPlaced', calleeIds: ['bob', 'carol'], mediaType: 'video', isGroup: true },
      { type: 'userSettled', uid: 'bob' },
    ]);
    expect(state.participants.map((p) => p.uid)).toEqual(['carol']);
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
