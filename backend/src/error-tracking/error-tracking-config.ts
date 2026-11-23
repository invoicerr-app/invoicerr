import { getInstalledVersion } from '../lib/app-version';

export type ErrorTrackingRole = 'api' | 'worker';

export interface ErrorTrackingConfig {
  dsn: string;
  environment: string;
  release: string;
  role: ErrorTrackingRole;
}

/** The release every Sentry event is tagged with, backend and browser alike: the installed version. */
export function sentryRelease(): string {
  return getInstalledVersion().version;
}

/**
 * `SENTRY_ENVIRONMENT` when set, otherwise the caller's own fallback. The backend falls back to
 * `NODE_ENV`, the browser to `production` (documented in the error-tracking user guide).
 */
export function sentryEnvironment(env: NodeJS.ProcessEnv, fallback: string): string {
  return env.SENTRY_ENVIRONMENT?.trim() || fallback;
}

/**
 * Error tracking is off unless `SENTRY_DSN` is set. The DSN can point at any Sentry-compatible
 * server (GlitchTip, a self-hosted Sentry); nothing is sent anywhere by default.
 */
export function readErrorTrackingConfig(
  role: ErrorTrackingRole,
  env: NodeJS.ProcessEnv = process.env,
): ErrorTrackingConfig | null {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return null;
  return {
    dsn,
    environment: sentryEnvironment(env, env.NODE_ENV || 'production'),
    release: sentryRelease(),
    role,
  };
}
