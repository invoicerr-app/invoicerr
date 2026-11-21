import { getInstalledVersion } from '../lib/app-version';

export type ErrorTrackingRole = 'api' | 'worker';

export interface ErrorTrackingConfig {
  dsn: string;
  environment: string;
  release: string;
  role: ErrorTrackingRole;
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
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'production',
    release: getInstalledVersion().version,
    role,
  };
}
