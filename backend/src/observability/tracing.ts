import type { IncomingMessage } from 'node:http';

import { isTracingEnabled } from './observability-config';

const UNTRACED_PATHS = ['/api/health', '/api/metrics'];

let started = false;

/**
 * Starts OpenTelemetry tracing when an OTLP endpoint is configured, and does nothing otherwise: the
 * SDK is not even loaded. Must run before the modules it instruments (http, express, Nest, pg,
 * ioredis) are first required, which is why `main.ts` and `worker.ts` import this file first. The
 * exporter reads the standard `OTEL_*` variables itself (endpoint, headers, protocol, sampler).
 */
export function startTracing(defaultServiceName: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (started || !isTracingEnabled(env)) return false;
  started = true;

  const { NodeSDK } = require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
  const { BatchSpanProcessor } =
    require('@opentelemetry/sdk-trace') as typeof import('@opentelemetry/sdk-trace');
  const { OTLPTraceExporter } =
    require('@opentelemetry/exporter-trace-otlp-http') as typeof import('@opentelemetry/exporter-trace-otlp-http');
  const { HttpInstrumentation } =
    require('@opentelemetry/instrumentation-http') as typeof import('@opentelemetry/instrumentation-http');
  const { ExpressInstrumentation } =
    require('@opentelemetry/instrumentation-express') as typeof import('@opentelemetry/instrumentation-express');
  const { NestInstrumentation } =
    require('@opentelemetry/instrumentation-nestjs-core') as typeof import('@opentelemetry/instrumentation-nestjs-core');
  const { PgInstrumentation } =
    require('@opentelemetry/instrumentation-pg') as typeof import('@opentelemetry/instrumentation-pg');
  const { IORedisInstrumentation } =
    require('@opentelemetry/instrumentation-ioredis') as typeof import('@opentelemetry/instrumentation-ioredis');
  const { RedactingSpanProcessor } = require('./span-redaction') as typeof import('./span-redaction');

  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME?.trim() || defaultServiceName,
    spanProcessors: [
      new RedactingSpanProcessor(new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })),
    ],
    // Traces only: metrics are scraped from the Prometheus endpoint, logs stay in the `Log` table.
    metricReaders: [],
    logRecordProcessors: [],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req: IncomingMessage) =>
          UNTRACED_PATHS.some((path) => req.url === path || req.url?.startsWith(`${path}?`)),
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      // Bound values never leave the process; only the parameterised SQL text does.
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new IORedisInstrumentation({ dbStatementSerializer: (command) => command }),
    ],
  });
  // No SIGTERM listener here: adding one would replace Node's default exit on that signal.
  sdk.start();
  return true;
}
