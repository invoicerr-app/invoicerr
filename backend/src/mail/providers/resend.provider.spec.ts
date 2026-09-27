/**
 * `ResendMailProvider` in isolation — mocked HTTP layer (same discipline `pdp-client.spec.ts` already
 * holds: no network calls, every `fetch()` mocked). Proves the exact request body Resend's own
 * documented API expects (`resend.provider.ts`'s own header cites the source), the attachment
 * encoding, and that an HTTP error surfaces the REAL Resend error message rather than a generic one.
 */

import { vi, type MockedFunction } from 'vitest';

import { ResendMailProvider } from './resend.provider';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch as unknown as typeof fetch;

function okResponse(body: unknown = { id: 'email-id-1' }): Partial<Response> {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

function errorResponse(status: number, body: unknown): Partial<Response> {
  return {
    ok: false,
    status,
    statusText: 'Error',
    text: async () => JSON.stringify(body),
  };
}

describe('ResendMailProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_USER;
  });

  it('throws at construction when no apiKey is available (env or explicit)', () => {
    expect(() => new ResendMailProvider()).toThrow(/RESEND_API_KEY/);
  });

  it('POSTs the exact body Resend documents — from/to/subject/html/text, snake_case attachment fields', async () => {
    mockFetch.mockResolvedValue(okResponse() as Response);

    const provider = new ResendMailProvider({ apiKey: 're_test_key', defaultFrom: 'Acme <me@acme.dev>' });
    await provider.sendMail({
      to: 'client@example.com',
      subject: 'Your invoice',
      html: '<p>Hello</p>',
      text: 'Hello',
      attachments: [
        { filename: 'invoice.pdf', content: Buffer.from('PDF-BYTES'), contentType: 'application/pdf' },
      ],
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');

    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test_key');
    expect(headers['Content-Type']).toBe('application/json');
    // Resend rejects any request with no User-Agent (403) — see this provider's own header.
    expect(headers['User-Agent']).toBeTruthy();

    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      from: 'Acme <me@acme.dev>',
      to: ['client@example.com'],
      subject: 'Your invoice',
      html: '<p>Hello</p>',
      text: 'Hello',
      attachments: [
        {
          filename: 'invoice.pdf',
          content: Buffer.from('PDF-BYTES').toString('base64'),
          content_type: 'application/pdf',
        },
      ],
    });
  });

  it('forwards options.replyTo as reply_to', async () => {
    mockFetch.mockResolvedValue(okResponse() as Response);
    const provider = new ResendMailProvider({ apiKey: 're_test_key', defaultFrom: 'me@acme.dev' });

    await provider.sendMail({
      to: 'client@example.com',
      subject: 'Hi',
      replyTo: 'support@company.example.com',
    });

    const body = JSON.parse((mockFetch.mock.calls[0][1]?.body as string) ?? '{}');
    expect(body.reply_to).toBe('support@company.example.com');
  });

  it('omits reply_to entirely when replyTo is not set (never null/empty string)', async () => {
    mockFetch.mockResolvedValue(okResponse() as Response);
    const provider = new ResendMailProvider({ apiKey: 're_test_key', defaultFrom: 'me@acme.dev' });

    await provider.sendMail({ to: 'client@example.com', subject: 'Hi' });

    const body = JSON.parse((mockFetch.mock.calls[0][1]?.body as string) ?? '{}');
    expect(body.reply_to).toBeUndefined();
    expect(Object.hasOwn(body, 'reply_to')).toBe(false);
  });

  it('omits the attachments field entirely when there are none (never an empty array)', async () => {
    mockFetch.mockResolvedValue(okResponse() as Response);
    const provider = new ResendMailProvider({ apiKey: 're_test_key', defaultFrom: 'me@acme.dev' });

    await provider.sendMail({ to: 'client@example.com', subject: 'Hi' });

    const body = JSON.parse((mockFetch.mock.calls[0][1]?.body as string) ?? '{}');
    expect(body.attachments).toBeUndefined();
  });

  it('falls back through MAIL_FROM -> SMTP_FROM -> SMTP_USER when no explicit from is given', async () => {
    process.env.SMTP_USER = 'fallback@example.com';
    mockFetch.mockResolvedValue(okResponse() as Response);

    const provider = new ResendMailProvider({ apiKey: 're_test_key' });
    await provider.sendMail({ to: 'client@example.com', subject: 'Hi' });

    const body = JSON.parse((mockFetch.mock.calls[0][1]?.body as string) ?? '{}');
    expect(body.from).toBe('fallback@example.com');
  });

  it('throws when no sender address can be resolved from any source', async () => {
    const provider = new ResendMailProvider({ apiKey: 're_test_key' });
    await expect(provider.sendMail({ to: 'client@example.com', subject: 'Hi' })).rejects.toThrow(
      /Missing sender email address/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when options.to is missing/blank', async () => {
    const provider = new ResendMailProvider({ apiKey: 're_test_key', defaultFrom: 'me@acme.dev' });
    await expect(provider.sendMail({ to: '  ', subject: 'Hi' })).rejects.toThrow(/recipient/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('propagates the REAL Resend error message on a non-2xx response', async () => {
    mockFetch.mockResolvedValue(
      errorResponse(422, {
        statusCode: 422,
        name: 'validation_error',
        message: 'Invalid `to` field.',
      }) as Response,
    );
    const provider = new ResendMailProvider({ apiKey: 're_test_key', defaultFrom: 'me@acme.dev' });

    await expect(provider.sendMail({ to: 'client@example.com', subject: 'Hi' })).rejects.toThrow(
      /HTTP 422.*validation_error: Invalid `to` field\./,
    );
  });

  it('propagates a raw non-JSON error body verbatim', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'upstream is on fire',
    } as Response);
    const provider = new ResendMailProvider({ apiKey: 're_test_key', defaultFrom: 'me@acme.dev' });

    await expect(provider.sendMail({ to: 'client@example.com', subject: 'Hi' })).rejects.toThrow(
      /HTTP 500.*upstream is on fire/,
    );
  });

  it('wraps a network failure (fetch itself throwing) rather than letting it escape raw', async () => {
    mockFetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.resend.com'));
    const provider = new ResendMailProvider({ apiKey: 're_test_key', defaultFrom: 'me@acme.dev' });

    await expect(provider.sendMail({ to: 'client@example.com', subject: 'Hi' })).rejects.toThrow(
      /Failed to reach the Resend API.*ENOTFOUND/,
    );
  });
});
