import type { Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace';

import { REDACTED, redactLogText } from '@/logger/redaction';

/** Attributes the HTTP instrumentation fills from the request URL (current and legacy names). */
const URL_ATTRIBUTES = ['url.full', 'url.path', 'url.query', 'http.target', 'http.url'] as const;

const FULL_URL_ATTRIBUTES: ReadonlySet<string> = new Set(['url.full', 'http.url']);

const SERVER_KIND = 1;

function originOf(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

type MutableAttributes = Record<string, unknown>;

/**
 * Applies the log redaction rules to a finished span before it is exported. Request paths and
 * query strings are dropped (public routes carry share tokens in the path; `http.route` keeps the
 * template), an outgoing URL keeps only its origin, and exception messages and SQL text go through
 * the same filter as a log line.
 */
export function redactSpan(span: ReadableSpan): void {
  const attributes = span.attributes as MutableAttributes;
  for (const key of URL_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value !== 'string') continue;
    const origin = span.kind !== SERVER_KIND && FULL_URL_ATTRIBUTES.has(key) ? originOf(value) : undefined;
    attributes[key] = origin ?? REDACTED;
  }
  for (const key of ['db.statement', 'db.query.text']) {
    const value = attributes[key];
    if (typeof value === 'string') attributes[key] = redactLogText(value);
  }
  for (const event of span.events) {
    const eventAttributes = event.attributes as MutableAttributes | undefined;
    if (!eventAttributes) continue;
    for (const key of ['exception.message', 'exception.stacktrace']) {
      const value = eventAttributes[key];
      if (typeof value === 'string') eventAttributes[key] = redactLogText(value);
    }
  }
  if (span.status.message) {
    (span.status as { message?: string }).message = redactLogText(span.status.message);
  }
}

export class RedactingSpanProcessor implements SpanProcessor {
  constructor(private readonly inner: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    redactSpan(span);
    this.inner.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}
