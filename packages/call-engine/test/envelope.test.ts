import { describe, expect, it } from 'vitest';

import { ErrorCode, isRtcError } from '../src/errors.js';
import { decodeEnvelope, encodeEnvelope, isEvent, okType } from '../src/signaling/envelope.js';
import { JOIN_FIELDS, LAYER_FIELDS } from '../src/signaling/frames.room.js';
import { encodeFrame, isRequestType, isReservedType, lookupFrame, newFrameData } from '../src/signaling/registry.js';

/** 手写用例补一致性向量没覆盖到的 TS 侧行为。 */

function expectCode(fn: () => unknown, code: number): void {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(isRtcError(thrown), `本该抛 RtcError，得到 ${String(thrown)}`).toBe(true);
  if (isRtcError(thrown)) expect(thrown.code).toBe(code);
}

describe('信封结构', () => {
  it.each([
    ['data 是数组', '{"type":"sys.ping","req_id":"c-1","ts":1,"data":[]}'],
    ['data 是字符串', '{"type":"sys.ping","req_id":"c-1","ts":1,"data":"{}"}'],
    ['整帧是数组', '[{"type":"sys.ping"}]'],
    ['整帧是 null', 'null'],
    ['不是合法 JSON', '{"type":"sys.ping",'],
    ['ts 是浮点', '{"type":"sys.ping","req_id":"c-1","ts":1.5,"data":{}}'],
    ['ts 是字符串', '{"type":"sys.ping","req_id":"c-1","ts":"1","data":{}}'],
    ['req_id 是数字', '{"type":"sys.ping","req_id":1,"ts":1,"data":{}}'],
    ['type 为空串', '{"type":"","req_id":"c-1","ts":1,"data":{}}'],
  ])('拒绝：%s', (_name, raw) => {
    expectCode(() => decodeEnvelope(raw), ErrorCode.badEnvelope);
  });

  it('事件的 req_id 是空串', () => {
    const envelope = decodeEnvelope(
      '{"type":"room.closed","req_id":"","ts":1,"data":{"room_id":"r-1"}}',
    );
    expect(isEvent(envelope)).toBe(true);
  });

  it('未知的顶层与 data 字段被忽略', () => {
    const envelope = decodeEnvelope(
      '{"type":"sys.ping","req_id":"c-1","ts":1,"data":{"future":1},"trace":"x"}',
    );
    expect(envelope.type).toBe('sys.ping');
  });

  it('编解码往返', () => {
    const raw = encodeEnvelope('call.hangup', 'c-9', { call_id: 'call-1' }, 1756876800123);
    const envelope = decodeEnvelope(raw);
    expect(envelope).toEqual({
      type: 'call.hangup',
      reqId: 'c-9',
      ts: 1756876800123,
      data: { call_id: 'call-1' },
    });
  });

  it('空 data 编码成 {} 而不是 null', () => {
    expect(encodeEnvelope('room.mute.ok', 'c-1', {}, 1)).toContain('"data":{}');
  });
});

describe('对象嵌套上限', () => {
  const frame = (data: string): string =>
    `{"type":"sys.ping","req_id":"c-1","ts":1,"data":${data}}`;

  it.each([
    ['两层合法', '{"limits":{"max_callees":8}}', true],
    ['数组里的对象仍是第二层', '{"speakers":[{"uid":"bob","volume":73}]}', true],
    ['三层非法', '{"a":{"b":{"c":1}}}', false],
    ['数组里的对象再嵌一层非法', '{"speakers":[{"meta":{"x":1}}]}', false],
  ])('%s', (_name, data, ok) => {
    if (ok) {
      expect(() => decodeEnvelope(frame(data))).not.toThrow();
    } else {
      expectCode(() => decodeEnvelope(frame(data)), ErrorCode.badParams);
    }
  });
});

describe('帧注册表', () => {
  it.each([
    ['room.mute', true],
    ['room.mute.ok', true],
    ['room.join.ok', true],
    ['call.ended.ok', false],
    ['room.offer.ok', false],
    ['room.mute_participant', false],
    ['room.nonexistent', false],
  ])('lookupFrame(%s)', (type, found) => {
    expect(lookupFrame(type) !== undefined).toBe(found);
  });

  it('会议留位帧不注册，但能识别出「将来会有」', () => {
    for (const type of ['room.kick', 'room.lock', 'room.raise_hand']) {
      expect(isReservedType(type)).toBe(true);
      expect(lookupFrame(type)).toBeUndefined();
    }
  });

  it('okType 与 isRequestType', () => {
    expect(okType('room.join')).toBe('room.join.ok');
    expect(isRequestType('room.join')).toBe(true);
    expect(isRequestType('room.closed')).toBe(false);
  });
});

describe('newFrameData —— 发送侧的默认值陷阱', () => {
  it('room.join 的默认值不是零值', () => {
    const join = newFrameData(JOIN_FIELDS);
    // 这三个默认值非零。直接写 { room_id: 'r-1' } 少了它们，
    // 显式写 false 又把 true 覆盖掉——两种写法都会让人进了房收不到流。
    expect(join.autoSubscribe).toBe(true);
    expect(join.publishAudio).toBe(true);
    expect(join.publishVideo).toBe(false);
  });

  it('room.subscribe 的 max_layer 默认是 m', () => {
    expect(newFrameData(LAYER_FIELDS).maxLayer).toBe('m');
  });

  it('编码回线路时用 snake_case', () => {
    const join = newFrameData(JOIN_FIELDS);
    join.roomId = 'r-1';
    join.roomToken = 'tk';
    expect(encodeFrame(JOIN_FIELDS, join)).toEqual({
      room_id: 'r-1',
      room_token: 'tk',
      auto_subscribe: true,
      publish_audio: true,
      publish_video: false,
    });
  });
});
