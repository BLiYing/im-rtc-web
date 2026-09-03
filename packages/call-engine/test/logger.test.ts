import { afterEach, describe, expect, it } from 'vitest';

import type { DiagnosticEntry, LogLevel } from '../src/logger.js';
import {
  LogField,
  clearDiagnostics,
  exportDiagnostics,
  logger,
  setLogClock,
  setLogLevel,
  setLogSink,
} from '../src/logger.js';
import { redact, redactCandidate, redactSdp } from '../src/redact.js';

interface Captured {
  level: LogLevel;
  message: string;
  fields: Readonly<Record<string, unknown>>;
}

function capture(): Captured[] {
  const out: Captured[] = [];
  setLogSink((level, message, fields) => out.push({ level, message, fields }));
  return out;
}

afterEach(() => {
  setLogSink(null);
  setLogLevel('info');
  setLogClock(null);
  clearDiagnostics();
});

describe('级别过滤', () => {
  it('低于最低级别的不输出', () => {
    const seen = capture();
    setLogLevel('warn');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(seen.map((s) => s.level)).toEqual(['warn', 'error']);
  });

  it('字段原样透传', () => {
    const seen = capture();
    logger.info('已进房', { [LogField.roomId]: 'r-1', [LogField.uid]: 'alice' });
    expect(seen[0]?.fields).toEqual({ room_id: 'r-1', uid: 'alice' });
  });
});

describe('诊断环形缓冲', () => {
  it('不受 setLogLevel 影响 —— 用户报障时正好没开 debug 等于什么都没有', () => {
    capture();
    setLogLevel('error'); // 只有 error 会输出
    logger.info('状态跃迁');
    logger.warn('重连中');
    logger.error('炸了');

    const entries = exportDiagnostics();
    expect(entries.map((e: DiagnosticEntry) => e.level)).toEqual(['info', 'warn', 'error']);
  });

  it('debug 不进缓冲（量太大）', () => {
    capture();
    setLogLevel('debug');
    logger.debug('每帧一条');
    expect(exportDiagnostics()).toHaveLength(0);
  });

  it('超出容量后丢最老的', () => {
    capture();
    for (let i = 0; i < 600; i += 1) logger.info(`m${i}`);
    const entries = exportDiagnostics();
    expect(entries).toHaveLength(512);
    expect(entries[0]?.message).toBe('m88'); // 600 - 512
    expect(entries.at(-1)?.message).toBe('m599');
  });

  it('带时间戳，clearDiagnostics 能清空', () => {
    capture();
    setLogClock(() => 1756876800123);
    logger.info('x');
    expect(exportDiagnostics()[0]?.atMs).toBe(1756876800123);
    clearDiagnostics();
    expect(exportDiagnostics()).toHaveLength(0);
  });
});

describe('脱敏 —— 与服务端 observability.Redact* 行为一致', () => {
  it.each([
    ['空串', '', '(empty)'],
    ['短于前缀长度', 'abc', '(len=3)'],
    ['恰好等于前缀长度', 'abcdef', '(len=6)'],
    ['正常 token', 'eyJhbGciOiJIUzI1NiJ9.payload.sig', 'eyJhbG…(len=32)'],
  ])('redact: %s', (_name, input, want) => {
    expect(redact(input)).toBe(want);
  });

  it('输出里绝不含完整凭据', () => {
    const secret = 'super-secret-token-value-that-must-not-leak';
    const got = redact(secret);
    expect(got).not.toContain(secret);
    expect(got.length).toBeLessThan(secret.length);
  });

  it('redactSdp 只留行数与 m= 行，不泄漏候选与指纹', () => {
    const sdp = [
      'v=0',
      'o=- 123 2 IN IP4 127.0.0.1',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=candidate:1 1 udp 2130706431 192.168.1.7 54321 typ host',
      'a=fingerprint:sha-256 AB:CD:EF',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
    ].join('\n');
    const got = redactSdp(sdp);
    expect(got).toBe('sdp(lines=6, m=audio,m=video)');
    for (const leak of ['192.168.1.7', '54321', 'AB:CD:EF', '127.0.0.1']) {
      expect(got).not.toContain(leak);
    }
  });

  it.each([
    ['host udp', 'candidate:1 1 udp 2130706431 192.168.1.7 54321 typ host', 'candidate(udp/host)'],
    ['srflx', 'candidate:2 1 UDP 1694498815 203.0.113.7 7881 typ srflx', 'candidate(udp/srflx)'],
    ['tcp', 'candidate:3 1 tcp 1518280447 10.0.0.5 9 typ host tcptype active', 'candidate(tcp/host)'],
    ['收集结束', '', '(end-of-candidates)'],
  ])('redactCandidate: %s', (_name, input, want) => {
    expect(redactCandidate(input)).toBe(want);
  });
});
