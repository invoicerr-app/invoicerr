import { describe, expect, it } from 'vitest';
import {
  buildConsentView,
  decisionFor,
  ERROR_TRACKING_CONSENT_TEXT_VERSION,
  isDecisionCurrent,
  parseConsentDecisionInput,
  type StoredConsentDecision,
} from './consent-policy';

const NOW = new Date('2026-11-21T12:00:00Z');
const ENV = { SENTRY_FRONTEND_DSN: 'https://public@glitchtip.example.test/2' } as NodeJS.ProcessEnv;

function stored(decision: StoredConsentDecision['decision'], decidedAt = NOW, textVersion?: string) {
  return { decision, decidedAt, textVersion: textVersion ?? ERROR_TRACKING_CONSENT_TEXT_VERSION };
}

describe('buildConsentView', () => {
  it('is off by default: no decision means not granted, a decision is required, nothing for the browser', () => {
    const view = buildConsentView(null, NOW, ENV);
    expect(view).toMatchObject({ available: true, granted: false, decisionRequired: true, decision: null });
    expect(view.browser).toBeNull();
  });

  it('hands the browser its config only for a current grant', () => {
    const view = buildConsentView(stored('granted'), NOW, ENV);
    expect(view.granted).toBe(true);
    expect(view.decisionRequired).toBe(false);
    expect(view.browser).toMatchObject({
      dsn: 'https://public@glitchtip.example.test/2',
      environment: 'production',
    });
  });

  it('withholds the config after a refusal or a withdrawal', () => {
    for (const decision of ['refused', 'withdrawn'] as const) {
      const view = buildConsentView(stored(decision), NOW, ENV);
      expect(view).toMatchObject({ granted: false, decisionRequired: false, decision, browser: null });
    }
  });

  it('asks again after six months, for a refusal as for a grant', () => {
    const old = new Date('2026-05-20T12:00:00Z');
    expect(buildConsentView(stored('granted', old), NOW, ENV)).toMatchObject({
      granted: false,
      decisionRequired: true,
      browser: null,
    });
    expect(buildConsentView(stored('refused', old), NOW, ENV).decisionRequired).toBe(true);
    expect(isDecisionCurrent(stored('refused', new Date('2026-05-22T12:00:00Z')), NOW)).toBe(true);
  });

  it('asks again when the consent text changed', () => {
    expect(buildConsentView(stored('granted', NOW, '2020-01-01'), NOW, ENV)).toMatchObject({
      granted: false,
      decisionRequired: true,
    });
  });

  it('reports nothing available, and asks nothing, on an instance without a browser DSN', () => {
    const view = buildConsentView(stored('granted'), NOW, {} as NodeJS.ProcessEnv);
    expect(view).toMatchObject({ available: false, granted: false, decisionRequired: false, browser: null });
  });

  it('never exposes the server DSN or any other setting', () => {
    const env = { ...ENV, SENTRY_DSN: 'https://server-secret@glitchtip.example.test/1' } as NodeJS.ProcessEnv;
    const serialized = JSON.stringify(buildConsentView(stored('granted'), NOW, env));
    expect(serialized).not.toContain('server-secret');
    expect(Object.keys(buildConsentView(stored('granted'), NOW, env).browser ?? {}).sort()).toEqual([
      'dsn',
      'environment',
      'release',
    ]);
  });
});

describe('decisionFor', () => {
  it('records a "no" after a grant as a withdrawal, otherwise as a refusal', () => {
    expect(decisionFor(true, null)).toBe('granted');
    expect(decisionFor(false, null)).toBe('refused');
    expect(decisionFor(false, stored('granted'))).toBe('withdrawn');
    expect(decisionFor(false, stored('withdrawn'))).toBe('refused');
  });
});

describe('parseConsentDecisionInput', () => {
  it('accepts a boolean and a known channel only', () => {
    expect(parseConsentDecisionInput({ granted: true, channel: 'banner' })).toEqual({
      granted: true,
      channel: 'banner',
    });
    expect(parseConsentDecisionInput({ granted: false, channel: 'settings' })).toEqual({
      granted: false,
      channel: 'settings',
    });
    expect(parseConsentDecisionInput({ granted: 'yes', channel: 'banner' })).toBeNull();
    expect(parseConsentDecisionInput({ granted: true, channel: 'email' })).toBeNull();
    expect(parseConsentDecisionInput(null)).toBeNull();
  });
});
