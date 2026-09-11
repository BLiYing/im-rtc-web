import { describe, expect, it } from 'vitest';

import { describeBrowser } from '../src/userAgent.js';

describe('describeBrowser', () => {
  const cases: readonly [string, string, string][] = [
    ['Chrome（macOS）',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Chrome 128'],
    ['Edge 带 Chrome/ 也要认成 Edge',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.42',
      'Edge 128'],
    ['Opera 带 Chrome/ 也要认成 Opera',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 OPR/113.0.0.0',
      'Opera 113'],
    ['Firefox',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0',
      'Firefox 130'],
    ['Safari 带 Version/',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'Safari 18.0'],
    ['iOS 上的 Chrome 是 CriOS',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1',
      'Chrome 128'],
    ['认不出来返回空串', 'curl/8.7.1', ''],
    ['空 UA', '', ''],
  ];

  it.each(cases)('%s', (_name, userAgent, want) => {
    expect(describeBrowser(userAgent)).toBe(want);
  });
});
