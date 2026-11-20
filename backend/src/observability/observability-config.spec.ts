import { isTracingEnabled, resolveMetricsConfig } from './observability-config';

describe('resolveMetricsConfig', () => {
  it('is off when METRICS_ENABLED is unset', () => {
    expect(resolveMetricsConfig({})).toEqual({ enabled: false, token: undefined });
  });

  it('turns on outside production without a token', () => {
    expect(resolveMetricsConfig({ METRICS_ENABLED: 'true', NODE_ENV: 'development' })).toEqual({
      enabled: true,
      token: undefined,
    });
  });

  it('refuses to open the endpoint in production without a token', () => {
    const config = resolveMetricsConfig({ METRICS_ENABLED: 'true', NODE_ENV: 'production' });
    expect(config.enabled).toBe(false);
    expect(config.refusal).toContain('METRICS_TOKEN');
  });

  it('turns on in production with a token', () => {
    expect(
      resolveMetricsConfig({ METRICS_ENABLED: 'TRUE', METRICS_TOKEN: ' s3cret ', NODE_ENV: 'production' }),
    ).toEqual({ enabled: true, token: 's3cret' });
  });
});

describe('isTracingEnabled', () => {
  it('is off without an OTLP endpoint', () => {
    expect(isTracingEnabled({})).toBe(false);
  });

  it('turns on with the generic or the traces endpoint', () => {
    expect(isTracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' })).toBe(true);
    expect(isTracingEnabled({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://collector:4318/v1/traces' })).toBe(
      true,
    );
  });

  it('stays off when OTEL_SDK_DISABLED is set', () => {
    expect(
      isTracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318', OTEL_SDK_DISABLED: 'true' }),
    ).toBe(false);
  });
});
