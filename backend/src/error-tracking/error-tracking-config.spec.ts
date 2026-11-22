import { describe, expect, it } from 'vitest';
import { readErrorTrackingConfig } from './error-tracking-config';

describe('readErrorTrackingConfig', () => {
  it('is off when SENTRY_DSN is unset or blank', () => {
    expect(readErrorTrackingConfig('api', {})).toBeNull();
    expect(readErrorTrackingConfig('api', { SENTRY_DSN: '   ' })).toBeNull();
  });

  it('reads the DSN, environment and role', () => {
    const config = readErrorTrackingConfig('worker', {
      SENTRY_DSN: ' https://key@errors.example.test/1 ',
      SENTRY_ENVIRONMENT: 'staging',
    });
    expect(config).toMatchObject({
      dsn: 'https://key@errors.example.test/1',
      environment: 'staging',
      role: 'worker',
    });
    expect(config?.release).toEqual(expect.any(String));
  });

  it('falls back to NODE_ENV, then production, for the environment', () => {
    expect(readErrorTrackingConfig('api', { SENTRY_DSN: 'x', NODE_ENV: 'test' })?.environment).toBe('test');
    expect(readErrorTrackingConfig('api', { SENTRY_DSN: 'x' })?.environment).toBe('production');
  });
});
