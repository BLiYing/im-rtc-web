import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CallProvider } from '../src/CallProvider.js';
import { CallOverlay } from '../src/components/CallOverlay.js';
import { endReasonText } from '../src/format/endReason.js';
import { LOCALES, MESSAGES } from '../src/i18n/messages.gen.js';
import { resolveLocale, setLocale, t } from '../src/i18n/index.js';
import { FakeEngine, asEngine } from './fakeEngine.js';

afterEach(() => setLocale('zh-CN'));

describe('文案表', () => {
  it('每种语言 key 一样多、没有空串', () => {
    const base = Object.keys(MESSAGES['zh-CN']);
    for (const l of LOCALES) {
      expect(Object.keys(MESSAGES[l]).sort()).toEqual([...base].sort());
      expect(Object.values(MESSAGES[l]).every((v) => v !== '')).toBe(true);
    }
  });

  it('占位符在各语言里一致', () => {
    const holes = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(MESSAGES['zh-CN']) as (keyof typeof MESSAGES['zh-CN'])[]) {
      expect(holes(MESSAGES.en[key]), key).toEqual(holes(MESSAGES['zh-CN'][key]));
    }
  });
});

describe('t / resolveLocale', () => {
  it('默认中文；切到 en 后出英文，带参数', () => {
    expect(t('end.busy')).toBe('对方忙线中');
    setLocale('en');
    expect(t('end.busy')).toBe('User is busy');
    expect(endReasonText('hangup', 'caller', 65)).toBe('Call ended · 01:05');
  });

  it('宿主覆盖优先，缺失回落 key', () => {
    setLocale('en', { en: { 'ctl.accept': 'Pick up' } });
    expect(t('ctl.accept')).toBe('Pick up');
    expect(t('nope' as never)).toBe('nope');
  });

  it('跟随系统：en-US → en，zh-Hant → zh-CN，未知 → 中文', () => {
    expect(resolveLocale('auto', ['en-US'])).toBe('en');
    expect(resolveLocale('auto', ['fr-FR', 'en-GB'])).toBe('en');
    expect(resolveLocale('auto', ['zh-Hant-TW'])).toBe('zh-CN');
    expect(resolveLocale('auto', ['ja'])).toBe('zh-CN');
    expect(resolveLocale('en', ['zh'])).toBe('en');
  });
});

describe('Provider locale', () => {
  it('来电页按 locale 出英文', () => {
    const engine = new FakeEngine();
    render(
      <CallProvider engine={asEngine(engine)} bannerFirst={false} locale="en">
        <CallOverlay />
      </CallProvider>,
    );
    act(() => {
      engine.emit('callReceived', { callId: 'c-1', caller: 'alice', calleeIds: [], mediaType: 'audio', isGroup: false });
    });
    expect(screen.getByTestId('accept-call').textContent).toContain('Accept');
    expect(screen.getByTestId('reject-call').textContent).toContain('Decline');
  });
});
