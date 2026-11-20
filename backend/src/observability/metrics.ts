import { timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

import { type MetricsConfig, resolveMetricsConfig } from './observability-config';

export const metricsRegistry = new Registry();

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration, by method, route template and status code.',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [metricsRegistry],
});

const httpServerErrors = new Counter({
  name: 'invoicerr_http_server_errors_total',
  help: 'HTTP responses with a 5xx status, by method and route template.',
  labelNames: ['method', 'route'] as const,
  registers: [metricsRegistry],
});

let defaultMetricsStarted = false;

/** Process and runtime metrics (CPU, memory, event loop lag, GC, start time) for one process. */
export function startDefaultMetrics(serviceName: string): void {
  if (defaultMetricsStarted) return;
  defaultMetricsStarted = true;
  metricsRegistry.setDefaultLabels({ service: serviceName });
  collectDefaultMetrics({ register: metricsRegistry });
}

/**
 * The route TEMPLATE, never the raw path: a raw path carries ids and public share tokens, and one
 * label value per id would also grow the series count without bound.
 */
export function routeLabel(req: Pick<Request, 'baseUrl' | 'route'>): string {
  const routePath = req.route?.path;
  if (typeof routePath !== 'string') return 'unmatched';
  return `${req.baseUrl ?? ''}${routePath}`;
}

export function recordHttpRequest(method: string, route: string, statusCode: number, seconds: number): void {
  const status = String(statusCode);
  httpRequestDuration.observe({ method, route, status_code: status }, seconds);
  if (statusCode >= 500) httpServerErrors.inc({ method, route });
}

export function httpMetricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.once('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      recordHttpRequest(req.method, routeLabel(req), res.statusCode, seconds);
    });
    next();
  };
}

function tokenMatches(expected: string, authorization: string | undefined): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  if (!match) return false;
  const given = Buffer.from(match[1].trim());
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export interface MetricsResponse {
  status: 200 | 401 | 404;
  contentType: string;
  body: string;
}

/** Shared by the API controller and the worker's health server, so both apply the same gate. */
export async function renderMetrics(
  authorization: string | undefined,
  config: MetricsConfig = resolveMetricsConfig(),
): Promise<MetricsResponse> {
  if (!config.enabled) return { status: 404, contentType: 'text/plain', body: 'Not Found' };
  if (config.token && !tokenMatches(config.token, authorization)) {
    return { status: 401, contentType: 'text/plain', body: 'Unauthorized' };
  }
  return { status: 200, contentType: metricsRegistry.contentType, body: await metricsRegistry.metrics() };
}
