import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { scrubEvent, stripQuery } from './scrub-event';

function event(overrides: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, ...overrides } as ErrorEvent;
}

describe('scrubEvent', () => {
  it('drops the user, including an IP address or the {{auto}} marker', () => {
    expect(scrubEvent(event({ user: { id: 'u1', ip_address: '203.0.113.7' } })).user).toBeUndefined();
    expect(scrubEvent(event({ user: { ip_address: '{{auto}}' } })).user).toBeUndefined();
  });

  it('keeps only method and path of the request', () => {
    const scrubbed = scrubEvent(
      event({
        request: {
          method: 'POST',
          url: 'https://app.example.test/api/documents?token=abc#frag',
          data: '{"password":"hunter2"}',
          cookies: { session: 'secret' },
          headers: { authorization: 'Bearer abc', 'x-forwarded-for': '203.0.113.7' },
          query_string: 'token=abc',
          env: { REMOTE_ADDR: '203.0.113.7' },
        },
      }),
    );
    expect(scrubbed.request).toEqual({ method: 'POST', url: 'https://app.example.test/api/documents' });
  });

  it('drops breadcrumbs and the host name', () => {
    const scrubbed = scrubEvent(
      event({ breadcrumbs: [{ message: 'mail to someone@example.test' }], server_name: 'pod-1' }),
    );
    expect(scrubbed.breadcrumbs).toBeUndefined();
    expect(scrubbed.server_name).toBeUndefined();
  });

  it('redacts emails and secrets from messages, exception values and extra context', () => {
    const scrubbed = scrubEvent(
      event({
        message: 'failed for someone@example.test',
        exception: { values: [{ type: 'Error', value: 'Bearer abcdefghijklmnop rejected' }] },
        extra: { email: 'someone@example.test', count: 3 },
        contexts: { custom: { password: 'hunter2' }, runtime: { name: 'node' } },
      }),
    );
    expect(scrubbed.message).not.toContain('someone@example.test');
    expect(scrubbed.exception?.values?.[0].value).not.toContain('abcdefghijklmnop');
    expect(scrubbed.extra).toEqual({ email: '[redacted]', count: 3 });
    expect(scrubbed.contexts?.custom).toEqual({ password: '[redacted]' });
    expect(scrubbed.contexts?.runtime).toEqual({ name: 'node' });
  });
});

describe('stripQuery', () => {
  it('cuts at the first ? or #', () => {
    expect(stripQuery('https://a.test/p?q=1')).toBe('https://a.test/p');
    expect(stripQuery('https://a.test/p#x')).toBe('https://a.test/p');
    expect(stripQuery('https://a.test/p')).toBe('https://a.test/p');
    expect(stripQuery(undefined)).toBeUndefined();
  });
});
