import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as Sentry from '@sentry/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureServerError, initErrorTracking, isErrorTrackingEnabled } from './error-tracking';

/**
 * Runs the real SDK against a local endpoint standing in for the tracker, and reads back the envelope
 * it actually sends: the scrubbing has to hold on the wire, not only in `scrubEvent`'s unit tests.
 */
describe('initErrorTracking (real SDK, local endpoint)', () => {
  let server: Server;
  const envelopes: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        envelopes.push(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200).end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    process.env.SENTRY_DSN = `http://publickey@127.0.0.1:${port}/1`;
  });

  afterAll(async () => {
    delete process.env.SENTRY_DSN;
    await Sentry.close(1_000);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends errors without any client IP, user, cookie or header', async () => {
    expect(initErrorTracking('api')).toBe(true);
    expect(isErrorTrackingEnabled()).toBe(true);

    Sentry.setUser({ id: 'user-1', ip_address: '{{auto}}', email: 'someone@example.test' });
    Sentry.addBreadcrumb({ message: 'GET /api/documents?token=abc' });
    Sentry.getCurrentScope().setSDKProcessingMetadata({
      normalizedRequest: {
        method: 'GET',
        url: 'https://app.example.test/api/documents?token=abc',
        headers: { cookie: 'session=secret', 'x-forwarded-for': '203.0.113.7' },
        data: '{"password":"hunter2"}',
      },
      ipAddress: '203.0.113.7',
    });
    captureServerError(new Error('boom for someone@example.test'));
    await Sentry.flush(2_000);

    expect(envelopes).toHaveLength(1);
    const body = envelopes[0];
    expect(body).toContain('"type":"event"');
    expect(body).toContain('boom for');
    for (const leaked of [
      '203.0.113.7',
      '{{auto}}',
      'ip_address',
      'someone@example.test',
      'user-1',
      'secret',
      'hunter2',
      'token=abc',
      'breadcrumbs',
    ]) {
      expect(body).not.toContain(leaked);
    }
  });
});
