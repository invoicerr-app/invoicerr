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

import {
  resolveCompanyMailSettings,
  resolveCompanyReplyTo,
} from '@/modules/company/mail-settings/company-mail-settings.resolver';

import {
  isInstanceMailProviderConfigured,
  MailService,
  NO_MAIL_SERVER_CONFIGURED_MESSAGE,
  resolveInstanceMailProviderId,
} from './mail.service';

vi.mock('@/modules/company/mail-settings/company-mail-settings.resolver', () => ({
  resolveCompanyMailSettings: vi.fn(),
  resolveCompanyReplyTo: vi.fn(),
}));

// Wholesale mock, deliberately: nothing in this file ever calls the REAL `createTransport` (every
// test below sets its own `.mockReturnValue(...)` before exercising the SUT), and under Vitest a
// real ESM module's namespace object is frozen — `vi.spyOn(nodemailer, 'createTransport')` (what
// this file used under Jest, which could still monkey-patch the CJS-transpiled exports object)
// throws "Cannot redefine property: createTransport" here. Mocking the module up front, then casting
// its export to `Mock` at each call site, is the Vitest-shaped equivalent.
vi.mock('nodemailer', () => ({ createTransport: vi.fn() }));

const mockedResolveCompanyMailSettings = resolveCompanyMailSettings as Mock;
const mockedResolveCompanyReplyTo = resolveCompanyReplyTo as Mock;

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
    // Nothing of its own to prove here (`Reply-To cascade` below is its own describe block) — every
    // pre-existing test in THIS block only cares about mail-SERVER resolution, so the company has no
    // Reply-To override by default, same as it never has in a fresh install.
    mockedResolveCompanyReplyTo.mockReset().mockResolvedValue(null);
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
    // Same reason: a real operator-set MAIL_REPLY_TO from the ambient shell must never leak into a
    // cascade test that does not explicitly set it — see the "Reply-To cascade" describe below.
    delete process.env.MAIL_REPLY_TO;
    // The company-SMTP branch validates its host against the shared SSRF guard before connecting,
    // which RESOLVES it for real. Which addresses that guard refuses is not what this file proves
    // (`modules/company/mail-settings/company-mail-settings.ssrf.spec.ts` does, against a mocked
    // resolver), and the example hostnames here deliberately do not exist — without this hatch the
    // cascade assertions below would depend on what the machine running them answers for those names.
    process.env.ALLOW_PRIVATE_OUTBOUND_URLS = '1';
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

describe('MailService#sendForCompany — the Reply-To cascade (resolveEffectiveReplyTo)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockedResolveCompanyMailSettings.mockReset();
    mockedResolveCompanyReplyTo.mockReset();
    mockFetch.mockReset();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_REPLY_TO;
    process.env.ALLOW_PRIVATE_OUTBOUND_URLS = '1';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  /** Drives the company's OWN SMTP override branch — the one-shot transport
   *  `deliverViaSmtp` builds — so the resolved Reply-To can be read straight off the mocked
   *  `transporter.sendMail` call args, independent of `sanitizedMailOptions`'s own plumbing. */
  async function sendThroughCompanySmtp(replyTo: string | null) {
    mockedResolveCompanyReplyTo.mockResolvedValue(replyTo);
    mockedResolveCompanyMailSettings.mockResolvedValue({
      kind: 'smtp',
      host: 'company-smtp.example.com',
      port: 587,
      secure: false,
      username: 'user',
      password: 'pass',
      fromAddress: 'billing@company.example.com',
    });
    const sendMailMock = vi.fn().mockResolvedValue(undefined);
    (nodemailer.createTransport as Mock).mockReturnValue({ sendMail: sendMailMock } as never);

    const service = new MailService();
    await service.sendForCompany('company-1', { to: 'client@example.com', subject: 'Hi' });
    return sendMailMock.mock.calls[0][0] as { replyTo?: string };
  }

  it('nothing set (no company override, no MAIL_REPLY_TO): no Reply-To header at all', async () => {
    const sent = await sendThroughCompanySmtp(null);
    expect(sent.replyTo).toBeUndefined();
  });

  it("instance only (MAIL_REPLY_TO set, no company override): the instance's value applies — even though this company uses ITS OWN SMTP server for the mail-server cascade", async () => {
    process.env.MAIL_REPLY_TO = 'ops@instance.example.com';
    const sent = await sendThroughCompanySmtp(null);
    expect(sent.replyTo).toBe('ops@instance.example.com');
  });

  it('company overrides instance: both set, the company value wins', async () => {
    process.env.MAIL_REPLY_TO = 'ops@instance.example.com';
    const sent = await sendThroughCompanySmtp('support@company.example.com');
    expect(sent.replyTo).toBe('support@company.example.com');
  });

  it('company set, instance unset: the company value still applies', async () => {
    const sent = await sendThroughCompanySmtp('support@company.example.com');
    expect(sent.replyTo).toBe('support@company.example.com');
  });

  it('an invalid MAIL_REPLY_TO is ignored on every send, not just rejected at some save step that does not exist for an env var', async () => {
    process.env.MAIL_REPLY_TO = 'not-an-email';
    const sent = await sendThroughCompanySmtp(null);
    expect(sent.replyTo).toBeUndefined();
  });

  it('also applies through the Resend branch of the mail-server cascade', async () => {
    mockedResolveCompanyReplyTo.mockResolvedValue('support@company.example.com');
    mockedResolveCompanyMailSettings.mockResolvedValue({
      kind: 'resend',
      apiKey: 're_company_key',
      fromAddress: 'billing@company.example.com',
    });
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"x"}' } as Response);

    const service = new MailService();
    await service.sendForCompany('company-1', { to: 'client@example.com', subject: 'Hi' });

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string) as { reply_to?: string };
    expect(body.reply_to).toBe('support@company.example.com');
  });

  it('also applies when the company has no mail-server override at all and falls back to the instance provider', async () => {
    process.env.RESEND_API_KEY = 're_instance_key';
    process.env.MAIL_FROM = 'noreply@instance.example.com';
    process.env.MAIL_REPLY_TO = 'ops@instance.example.com';
    mockedResolveCompanyMailSettings.mockResolvedValue(null);
    mockedResolveCompanyReplyTo.mockResolvedValue(null);
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"x"}' } as Response);

    const service = new MailService();
    await service.sendForCompany('company-1', { to: 'client@example.com', subject: 'Hi' });

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string) as { reply_to?: string };
    expect(body.reply_to).toBe('ops@instance.example.com');
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
    // Same reason as the cascade describe above: `smtpOverrides` goes through the same endpoint guard,
    // and `smtp.example.com` is not a name this suite may depend on resolving.
    process.env.ALLOW_PRIVATE_OUTBOUND_URLS = '1';
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

  it('never injects the instance MAIL_REPLY_TO into an smtpOverrides send (e.g. the PEC transport) — no company is even in play here', async () => {
    process.env.MAIL_REPLY_TO = 'ops@instance.example.com';
    const sendMailMock = vi.fn().mockResolvedValue(undefined);
    (nodemailer.createTransport as Mock).mockReturnValue({ sendMail: sendMailMock } as never);

    const service = new MailService();
    await service.sendMail(
      { to: 'client@example.com', subject: 'Hi' },
      {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        username: 'user',
        password: 'pass',
        fromAddress: 'billing@company.example.com',
      },
    );

    expect(sendMailMock.mock.calls[0][0].replyTo).toBeUndefined();
  });
});

describe('MailService#sendMail — the instance-only path (no smtpOverrides, no company)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_REPLY_TO;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("applies the instance's own MAIL_REPLY_TO when sending with no company and no smtpOverrides (e.g. the instance-reset OTP, an account-change confirmation)", async () => {
    process.env.RESEND_API_KEY = 're_instance_key';
    process.env.MAIL_FROM = 'noreply@instance.example.com';
    process.env.MAIL_REPLY_TO = 'ops@instance.example.com';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"id":"x"}',
    } as Response);
    global.fetch = mockFetch as unknown as typeof fetch;

    const service = new MailService();
    await service.sendMail({ to: 'client@example.com', subject: 'Hi' });

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string) as { reply_to?: string };
    expect(body.reply_to).toBe('ops@instance.example.com');
  });

  it('no Reply-To header when MAIL_REPLY_TO is unset', async () => {
    process.env.RESEND_API_KEY = 're_instance_key';
    process.env.MAIL_FROM = 'noreply@instance.example.com';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"id":"x"}',
    } as Response);
    global.fetch = mockFetch as unknown as typeof fetch;

    const service = new MailService();
    await service.sendMail({ to: 'client@example.com', subject: 'Hi' });

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string) as { reply_to?: string };
    expect(body.reply_to).toBeUndefined();
  });
});
