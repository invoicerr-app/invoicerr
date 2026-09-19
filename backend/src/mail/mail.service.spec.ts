/**
 * `MailService` — the instance-level provider RESOLUTION TABLE and the
 * "company → instance → named refusal" `sendForCompany` cascade. `resolveCompanyMailSettings` (the
 * company-level READ side, `modules/company/mail-settings/company-mail-settings.resolver.ts`) is
 * mocked here — its own round-trip/encryption behavior is proven by
 * `company-mail-settings.service.spec.ts` instead; this file only proves MailService's OWN decision
 * logic given whatever that resolver returns.
 */

import { vi, type MockedFunction, type Mock } from 'vitest';

import * as nodemailer from 'nodemailer';

import { resolveCompanyMailSettings } from '@/modules/company/mail-settings/company-mail-settings.resolver';

import {
  isInstanceMailProviderConfigured,
  MailService,
  NO_MAIL_SERVER_CONFIGURED_MESSAGE,
  resolveInstanceMailProviderId,
} from './mail.service';

vi.mock('@/modules/company/mail-settings/company-mail-settings.resolver', () => ({
  resolveCompanyMailSettings: vi.fn(),
}));

// Wholesale mock, deliberately: nothing in this file ever calls the REAL `createTransport` (every
// test below sets its own `.mockReturnValue(...)` before exercising the SUT), and under Vitest a
// real ESM module's namespace object is frozen — `vi.spyOn(nodemailer, 'createTransport')` (what
// this file used under Jest, which could still monkey-patch the CJS-transpiled exports object)
// throws "Cannot redefine property: createTransport" here. Mocking the module up front, then casting
// its export to `Mock` at each call site, is the Vitest-shaped equivalent.
vi.mock('nodemailer', () => ({ createTransport: vi.fn() }));

const mockedResolveCompanyMailSettings = resolveCompanyMailSettings as Mock;

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch as unknown as typeof fetch;

describe('resolveInstanceMailProviderId — the resolution table', () => {
  it('rien: MAIL_PROVIDER unset, RESEND_API_KEY absent, SMTP_HOST absent -> smtp (historical default)', () => {
    expect(resolveInstanceMailProviderId({})).toBe('smtp');
  });

  it('SMTP seul: MAIL_PROVIDER unset, only SMTP_HOST set -> smtp', () => {
    expect(resolveInstanceMailProviderId({ SMTP_HOST: 'smtp.example.com' })).toBe('smtp');
  });

  it('Resend seul: MAIL_PROVIDER unset, only RESEND_API_KEY set -> resend', () => {
    expect(resolveInstanceMailProviderId({ RESEND_API_KEY: 're_123' })).toBe('resend');
  });

  it('les deux: MAIL_PROVIDER unset, RESEND_API_KEY AND SMTP_HOST both set -> resend wins', () => {
    expect(resolveInstanceMailProviderId({ RESEND_API_KEY: 're_123', SMTP_HOST: 'smtp.example.com' })).toBe(
      'resend',
    );
  });

  it('an explicit MAIL_PROVIDER=smtp always wins, even with RESEND_API_KEY also set', () => {
    expect(
      resolveInstanceMailProviderId({
        MAIL_PROVIDER: 'smtp',
        RESEND_API_KEY: 're_123',
        SMTP_HOST: 'smtp.example.com',
      }),
    ).toBe('smtp');
  });

  it('an explicit MAIL_PROVIDER=resend is honored with no RESEND_API_KEY present (fails later, at construction)', () => {
    expect(resolveInstanceMailProviderId({ MAIL_PROVIDER: 'resend' })).toBe('resend');
  });

  it('an unknown MAIL_PROVIDER throws, naming the supported values', () => {
    expect(() => resolveInstanceMailProviderId({ MAIL_PROVIDER: 'sendgrid' })).toThrow(
      /Unknown MAIL_PROVIDER "sendgrid".*smtp.*resend/,
    );
  });

  it('an explicit MAIL_PROVIDER=brevo throws a clear removal message instead of falling back silently', () => {
    expect(() => resolveInstanceMailProviderId({ MAIL_PROVIDER: 'brevo' })).toThrow(
      "MAIL_PROVIDER=brevo is no longer supported; use smtp (Brevo's SMTP relay works) or resend",
    );
  });
});

describe('isInstanceMailProviderConfigured', () => {
  it('false when neither RESEND_API_KEY nor SMTP_HOST is set', () => {
    expect(isInstanceMailProviderConfigured({})).toBe(false);
  });

  it('true when only SMTP_HOST is set', () => {
    expect(isInstanceMailProviderConfigured({ SMTP_HOST: 'smtp.example.com' })).toBe(true);
  });

  it('true when only RESEND_API_KEY is set', () => {
    expect(isInstanceMailProviderConfigured({ RESEND_API_KEY: 're_123' })).toBe(true);
  });
});

describe('MailService#sendForCompany — the société → instance → refus nommé cascade', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.restoreAllMocks(); // undoes any prior test's `(nodemailer.createTransport as Mock).mockReturnValue(...)`
    mockedResolveCompanyMailSettings.mockReset();
    mockFetch.mockReset();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    // MAIL_FROM/SMTP_FROM/SMTP_USER feed the provider's "from" address only — not the resolution
    // table under test here — but a value left over from the real shell environment must never leak
    // into these assertions; each test that needs one sets it explicitly (see e.g. the instance
    // fallback test below).
    delete process.env.MAIL_FROM;
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_USER;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("uses the company's own SMTP override when one is configured, never touching the instance provider", async () => {
    process.env.SMTP_HOST = 'instance-smtp.example.com'; // instance IS configured too — must be ignored
    const sendMailMock = vi.fn().mockResolvedValue(undefined);
    (nodemailer.createTransport as Mock).mockReturnValue({ sendMail: sendMailMock } as never);

    mockedResolveCompanyMailSettings.mockResolvedValue({
      kind: 'smtp',
      host: 'company-smtp.example.com',
      port: 587,
      secure: false,
      username: 'user',
      password: 'pass',
      fromAddress: 'billing@company.example.com',
    });

    const service = new MailService();
    const result = await service.sendForCompany('company-1', { to: 'client@example.com', subject: 'Hi' });

    expect(result).toEqual({ message: 'Email sent successfully' });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'company-smtp.example.com' }),
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses the company's own Resend override when one is configured", async () => {
    mockedResolveCompanyMailSettings.mockResolvedValue({
      kind: 'resend',
      apiKey: 're_company_key',
      fromAddress: 'billing@company.example.com',
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"x"}' } as Response);

    const service = new MailService();
    await service.sendForCompany('company-1', { to: 'client@example.com', subject: 'Hi' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_company_key');
  });

  it('falls back to the instance provider when the company has none configured', async () => {
    process.env.RESEND_API_KEY = 're_instance_key';
    process.env.MAIL_FROM = 'noreply@instance.example.com';
    mockedResolveCompanyMailSettings.mockResolvedValue(null);
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"x"}' } as Response);

    const service = new MailService();
    await service.sendForCompany('company-1', { to: 'client@example.com', subject: 'Hi' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_instance_key');
  });

  it('refuses NAMED, before any network attempt, when neither company nor instance is configured', async () => {
    mockedResolveCompanyMailSettings.mockResolvedValue(null);
    // MAIL_PROVIDER unset, RESEND_API_KEY unset, SMTP_HOST unset -> "rien" (constructor falls back to
    // smtp with a startup warning; sendForCompany must still refuse rather than attempt that socket).
    const service = new MailService();

    await expect(
      service.sendForCompany('company-1', { to: 'client@example.com', subject: 'Hi' }),
    ).rejects.toThrow(NO_MAIL_SERVER_CONFIGURED_MESSAGE);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sanitizes a stored value baked into html before it ever reaches the company's Resend request", async () => {
    // Mirrors a real caller (mail/system-email-templates.ts#buildLegalDocumentChangedEmail)
    // interpolating a legal document's front-matter title straight into an html string with no
    // escaping of its own — the html part is trusted to be markup, never to be safe by construction.
    mockedResolveCompanyMailSettings.mockResolvedValue({
      kind: 'resend',
      apiKey: 're_company_key',
      fromAddress: 'billing@company.example.com',
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"x"}' } as Response);

    const service = new MailService();
    await service.sendForCompany('company-1', {
      to: 'client@example.com',
      subject: 'Hi',
      html: '<p>Hello</p><script>alert(document.cookie)</script>',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string) as { html: string };
    expect(body.html).toBe('<p>Hello</p>');
    expect(body.html).not.toContain('script');
  });
});

describe('MailService#sendMail — per-company SMTP override', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Isolated from whatever the real shell happens to export — the provider actually selected here
    // must be deterministic (nothing about smtpOverrides depends on it, but MailService's constructor
    // still runs `resolveInstanceMailProviderId` and would otherwise try to build a real
    // ResendMailProvider against a real key from the ambient environment).
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('sanitizes html before it reaches the one-shot SMTP transport built for smtpOverrides', async () => {
    const sendMailMock = vi.fn().mockResolvedValue(undefined);
    (nodemailer.createTransport as Mock).mockReturnValue({ sendMail: sendMailMock } as never);

    const service = new MailService();
    await service.sendMail(
      { to: 'client@example.com', subject: 'Hi', html: '<p>Hello</p><script>alert(1)</script>' },
      {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        username: 'user',
        password: 'pass',
        fromAddress: 'billing@company.example.com',
      },
    );

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const sentHtml = sendMailMock.mock.calls[0][0].html as string;
    expect(sentHtml).toBe('<p>Hello</p>');
    expect(sentHtml).not.toContain('script');
  });
});
