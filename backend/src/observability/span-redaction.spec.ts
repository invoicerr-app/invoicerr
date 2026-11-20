import type { ReadableSpan } from '@opentelemetry/sdk-trace';

import { REDACTED } from '@/logger/redaction';

import { redactSpan } from './span-redaction';

function span(kind: number, attributes: Record<string, unknown>, events: ReadableSpan['events'] = []) {
  return { kind, attributes, events, status: { code: 0 } } as unknown as ReadableSpan;
}

describe('redactSpan', () => {
  it('drops the URL of an incoming request but keeps the route template', () => {
    const s = span(1, {
      'url.path': '/api/public/documents/abc123token',
      'http.target': '/api/public/documents/abc123token?x=1',
      'http.route': '/api/public/documents/:token',
    });
    redactSpan(s);
    expect(s.attributes['url.path']).toBe(REDACTED);
    expect(s.attributes['http.target']).toBe(REDACTED);
    expect(s.attributes['http.route']).toBe('/api/public/documents/:token');
  });

  it('keeps only the origin of an outgoing request', () => {
    const s = span(2, {
      'url.full': 'https://api.example.test/v1/files/abc123token?api_key=s3cret',
      'url.path': '/v1/files/abc123token',
      'url.query': 'api_key=s3cret',
    });
    redactSpan(s);
    expect(s.attributes['url.full']).toBe('https://api.example.test');
    expect(s.attributes['url.path']).toBe(REDACTED);
    expect(s.attributes['url.query']).toBe(REDACTED);
  });

  it('redacts email addresses in exception events', () => {
    const s = span(0, {}, [
      {
        name: 'exception',
        time: [0, 0],
        attributes: { 'exception.message': 'No account for jane@example.test' },
      },
    ] as ReadableSpan['events']);
    redactSpan(s);
    expect(s.events[0].attributes?.['exception.message']).not.toContain('jane@example.test');
  });
});
