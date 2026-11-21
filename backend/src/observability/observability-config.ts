/**
 * Every observability signal is off unless the operator turns it on: a self-hosted instance sends
 * nothing anywhere and exposes nothing extra by default.
 */

export interface MetricsConfig {
  enabled: boolean;
  token: string | undefined;
  /** Set when `METRICS_ENABLED` was asked for but refused, so boot can say why. */
  refusal?: string;
  /** Set when the endpoint is on without a token, so boot can say it is open to anyone. */
  warning?: string;
}

export function resolveMetricsConfig(env: NodeJS.ProcessEnv = process.env): MetricsConfig {
  const requested = env.METRICS_ENABLED?.trim().toLowerCase() === 'true';
  const token = env.METRICS_TOKEN?.trim() || undefined;
  if (!requested) return { enabled: false, token };
  // `/api/metrics` sits behind the same public reverse proxy as the rest of the API.
  if (!token && env.NODE_ENV === 'production') {
    return {
      enabled: false,
      token,
      refusal: 'METRICS_ENABLED=true is ignored in production without METRICS_TOKEN.',
    };
  }
  if (!token) {
    return {
      enabled: true,
      token,
      warning:
        'METRICS_ENABLED=true without METRICS_TOKEN: /api/metrics is readable by anyone who can reach it. Set METRICS_TOKEN before exposing this instance.',
    };
  }
  return { enabled: true, token };
}

export function isTracingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.OTEL_SDK_DISABLED?.trim().toLowerCase() === 'true') return false;
  return !!(env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim());
}
