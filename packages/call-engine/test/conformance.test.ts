import { describe, expect, it } from 'vitest';

import { ERROR_DEFINITIONS, errorName, isRtcError } from '../src/errors.js';
import {
  CallEndReason,
  GROUP_DOMINANT_PRIORITY,
  callDurationSec,
  dominantReason,
  normalizeReason,
} from '../src/reasons.js';
import { decodeEnvelope } from '../src/signaling/envelope.js';
import { encodeFrame, lookupFrame } from '../src/signaling/registry.js';
import type { FrameData, FrameFields } from '../src/signaling/fieldSpec.js';
import { decodeFields } from '../src/signaling/fieldSpec.js';
import type { EnvelopeVector, ErrorCodeVector, ReasonVector } from './vectors.js';
import { loadVector } from './vectors.js';

/**
 * 本文件把 `im-rtc-server/docs/conformance/*.json` 跑成 TS 测试。
 * **四仓跑同一份向量**——这是「协议在四种语言里行为一致」的唯一机器化证明。
 */

/** parseFrame 是两步解析：先信封（含编码硬规则），再帧级 data。 */
function parseFrame(raw: string): {
  type: string;
  reqId: string;
  ts: number;
  wireData: Record<string, unknown> | undefined;
} {
  const envelope = decodeEnvelope(raw);
  const fields = lookupFrame(envelope.type);
  if (fields === undefined) {
    return { type: envelope.type, reqId: envelope.reqId, ts: envelope.ts, wireData: undefined };
  }
  const decoded = decodeFields(fields, envelope.data);
  // 解回来再编回去：向量的 expect_data 用的是线路上的 snake_case 名。
  return {
    type: envelope.type,
    reqId: envelope.reqId,
    ts: envelope.ts,
    wireData: encodeFrame(fields, decoded as FrameData<FrameFields>),
  };
}

/** expectSubset 做**子集比对**：向量写了哪些键就只比哪些键。 */
function expectSubset(actual: unknown, want: unknown, path: string): void {
  if (Array.isArray(want)) {
    expect(Array.isArray(actual), `${path} 应当是数组`).toBe(true);
    const got = actual as unknown[];
    expect(got.length, `${path} 长度`).toBe(want.length);
    want.forEach((item, i) => expectSubset(got[i], item, `${path}[${i}]`));
    return;
  }
  if (want !== null && typeof want === 'object') {
    expect(typeof actual, `${path} 应当是对象`).toBe('object');
    const got = actual as Record<string, unknown>;
    for (const [key, value] of Object.entries(want)) {
      expect(Object.hasOwn(got, key), `${path}.${key} 应当存在`).toBe(true);
      expectSubset(got[key], value, `${path}.${key}`);
    }
    return;
  }
  expect(actual, path).toEqual(want);
}

describe('envelope.json —— 信封解析与默认值', () => {
  const vector = loadVector<EnvelopeVector>('envelope.json');
  expect(vector.kind).toBe('envelope');
  expect(vector.version).toBe(1);

  it.each(vector.cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    if (!testCase.expect.ok) {
      let thrown: unknown;
      try {
        parseFrame(testCase.input);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, '本该失败').toBeDefined();
      expect(isRtcError(thrown), `错误应当是 RtcError，得到 ${String(thrown)}`).toBe(true);
      if (isRtcError(thrown)) {
        expect(errorName(thrown.code)).toBe(testCase.expect.error);
      }
      return;
    }

    // 未知 type：客户端静默忽略，服务端回 1002。两侧都不该在信封阶段失败。
    if (testCase.expect.client_action === 'ignore' || testCase.expect.server_action === 'error') {
      const envelope = decodeEnvelope(testCase.input);
      expect(envelope.type).toBe(testCase.expect.type);
      expect(lookupFrame(envelope.type), '本该是未注册的帧').toBeUndefined();
      return;
    }

    const parsed = parseFrame(testCase.input);
    if (testCase.expect.type !== undefined) expect(parsed.type).toBe(testCase.expect.type);
    if (testCase.expect.req_id !== undefined) expect(parsed.reqId).toBe(testCase.expect.req_id);
    if (testCase.expect.ts !== undefined) expect(parsed.ts).toBe(testCase.expect.ts);
    if (testCase.expect.data !== undefined) {
      expect(parsed.wireData, `${parsed.type} 应当有已注册的字段声明`).toBeDefined();
      expectSubset(parsed.wireData, testCase.expect.data, 'data');
    }
  });

  it.each(vector.default_cases.map((c) => [c.name, c] as const))(
    'default: %s',
    (_name, testCase) => {
      const raw = JSON.stringify({
        type: testCase.type,
        req_id: 'c-1',
        ts: 1756876800123,
        data: JSON.parse(testCase.input_data) as unknown,
      });
      const parsed = parseFrame(raw);
      expect(parsed.wireData, `${testCase.type} 应当有已注册的字段声明`).toBeDefined();
      expectSubset(parsed.wireData, testCase.expect_data, 'data');
    },
  );
});

describe('error_codes.json —— 错误码表', () => {
  const vector = loadVector<ErrorCodeVector>('error_codes.json');

  it('TS 的表与向量逐条相等', () => {
    const want = new Map(
      [...vector.wire, ...vector.local].map((e) => [
        e.code,
        { code: e.code, name: e.name, msg: e.msg, retryable: e.retryable, local: e.group === 'local' },
      ]),
    );
    const got = new Map(ERROR_DEFINITIONS.map((d) => [d.code, { ...d }]));

    expect([...got.keys()].sort((a, b) => a - b)).toEqual([...want.keys()].sort((a, b) => a - b));
    for (const [code, expected] of want) {
      expect(got.get(code), `错误码 ${code}`).toEqual(expected);
    }
  });

  it('2xxx 段与 local 标记一致（本地码永不上线路）', () => {
    for (const def of ERROR_DEFINITIONS) {
      expect(def.local, `${def.code}(${def.name})`).toBe(def.code >= 2000 && def.code < 3000);
    }
  });
});

describe('reasons.json —— reason 枚举与群主导优先级', () => {
  const vector = loadVector<ReasonVector>('reasons.json');

  it('枚举取值与向量一致', () => {
    expect(Object.values(CallEndReason).sort()).toEqual(
      vector.reasons.map((r) => r.value).sort(),
    );
  });

  it('未知值兜底为 error', () => {
    expect(vector.unknown_fallback).toBe('error');
    expect(normalizeReason('supernova')).toBe(CallEndReason.error);
    expect(normalizeReason(undefined)).toBe(CallEndReason.error);
    expect(normalizeReason(42)).toBe(CallEndReason.error);
  });

  it('群通话主导优先级与向量一致', () => {
    expect([...GROUP_DOMINANT_PRIORITY]).toEqual(vector.group_dominant_priority);
  });

  it.each(vector.group_dominant_cases.map((c) => [c.name, c] as const))(
    'dominant: %s',
    (_name, testCase) => {
      expect(dominantReason(testCase.member_outcomes)).toBe(testCase.expect);
    },
  );

  it.each(vector.duration_cases.map((c) => [c.name, c] as const))(
    'duration: %s',
    (_name, testCase) => {
      expect(callDurationSec(testCase.connected_at_ms, testCase.ended_at_ms)).toBe(
        testCase.expect_duration_sec,
      );
    },
  );
});
