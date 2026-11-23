import { sentryEnvironment, sentryRelease } from '../error-tracking-config';

/**
 * Version of the text a user is shown when asked about browser error reporting (the banner and the
 * account setting). Bump it whenever that text changes in substance: every stored decision made
 * against an older version is then asked again.
 */
export const ERROR_TRACKING_CONSENT_TEXT_VERSION = '2026-11-21';

/**
 * A decision, granted or refused, is asked again after six months. Legal advice on this feature: a
 * refusal must not be re-asked sooner, and a grant should not be presumed to last indefinitely.
 */
const ERROR_TRACKING_CONSENT_REASK_MONTHS = 6;

export type ErrorTrackingConsentChannel = 'banner' | 'settings';

export const ERROR_TRACKING_CONSENT_CHANNELS: readonly ErrorTrackingConsentChannel[] = ['banner', 'settings'];

export type ErrorTrackingConsentDecision = 'granted' | 'refused' | 'withdrawn';

export interface StoredConsentDecision {
  decision: ErrorTrackingConsentDecision;
  textVersion: string;
  decidedAt: Date;
}

export interface BrowserErrorTrackingConfig {
  dsn: string;
  environment: string;
  release: string;
}

export interface ErrorTrackingConsentView {
  /** Whether this instance collects browser error reports at all (`SENTRY_FRONTEND_DSN` set). */
  available: boolean;
  /** True only for a grant that is still valid: current text version and less than six months old. */
  granted: boolean;
  /** True when the user has to be asked: no decision yet, an expired one, or one on an older text. */
  decisionRequired: boolean;
  textVersion: string;
  /** The latest stored decision, even an expired one, or null when the user was never asked. */
  decision: ErrorTrackingConsentDecision | null;
  decidedAt: string | null;
  /**
   * What the browser needs to start the SDK. Null unless `granted` is true, so the collection
   * address never reaches a browser whose user has not agreed, nor an anonymous visitor.
   */
  browser: BrowserErrorTrackingConfig | null;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/** A decision counts only while it is on the current text and younger than the re-ask delay. */
export function isDecisionCurrent(decision: StoredConsentDecision | null, now: Date): boolean {
  if (!decision) return false;
  if (decision.textVersion !== ERROR_TRACKING_CONSENT_TEXT_VERSION) return false;
  return addMonths(decision.decidedAt, ERROR_TRACKING_CONSENT_REASK_MONTHS) > now;
}

function readBrowserErrorTrackingConfig(
  env: NodeJS.ProcessEnv = process.env,
): BrowserErrorTrackingConfig | null {
  const dsn = env.SENTRY_FRONTEND_DSN?.trim();
  if (!dsn) return null;
  return {
    dsn,
    environment: sentryEnvironment(env, 'production'),
    release: sentryRelease(),
  };
}

export function buildConsentView(
  latest: StoredConsentDecision | null,
  now: Date,
  env: NodeJS.ProcessEnv = process.env,
): ErrorTrackingConsentView {
  const browser = readBrowserErrorTrackingConfig(env);
  const current = isDecisionCurrent(latest, now);
  const granted = browser !== null && current && latest?.decision === 'granted';
  return {
    available: browser !== null,
    granted,
    decisionRequired: browser !== null && !current,
    textVersion: ERROR_TRACKING_CONSENT_TEXT_VERSION,
    decision: latest ? latest.decision : null,
    decidedAt: latest ? latest.decidedAt.toISOString() : null,
    browser: granted ? browser : null,
  };
}

export function parseConsentDecisionInput(body: unknown): {
  granted: boolean;
  channel: ErrorTrackingConsentChannel;
} | null {
  if (!body || typeof body !== 'object') return null;
  const { granted, channel } = body as { granted?: unknown; channel?: unknown };
  if (typeof granted !== 'boolean') return null;
  if (
    typeof channel !== 'string' ||
    !(ERROR_TRACKING_CONSENT_CHANNELS as readonly string[]).includes(channel)
  ) {
    return null;
  }
  return { granted, channel: channel as ErrorTrackingConsentChannel };
}

/**
 * What a "no" is recorded as: `withdrawn` when it ends a grant (the latest row is a grant, expired or
 * not, since the SDK may still be running on that grant), `refused` otherwise.
 */
export function decisionFor(
  granted: boolean,
  latest: StoredConsentDecision | null,
): ErrorTrackingConsentDecision {
  if (granted) return 'granted';
  return latest?.decision === 'granted' ? 'withdrawn' : 'refused';
}
