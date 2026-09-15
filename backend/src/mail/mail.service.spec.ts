/**
 * `MailService` — the instance-level provider RESOLUTION TABLE (TODO_FEATURES.md entry G) and the
 * "société → instance → refus nommé" `sendForCompany` cascade. `resolveCompanyMailSettings` (the
 * company-level READ side, `modules/company/mail-settings/company-mail-settings.resolver.ts`) is
 * mocked here — its own round-trip/encryption behavior is proven by
 * `company-mail-settings.service.spec.ts` instead; this file only proves MailService's OWN decision
 * logic given whatever that resolver returns.
 */
import * as nodemailer from 'nodemailer';

import { resolveCompanyMailSettings } from '@/modules/company/mail-settings/company-mail-settings.resolver';

import {
  isInstanceMailProviderConfigured,
  MailService,
  NO_MAIL_SERVER_CONFIGURED_MESSAGE,
  resolveInstanceMailProviderId,
} from './mail.service';

jest.mock('@/modules/company/mail-settings/company-mail-settings.resolver', () => ({
  resolveCompanyMailSettings: jest.fn(),
}));

const mockedResolveCompanyMailSettings = resolveCompanyMailSettings as jest.Mock;

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
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
      /Unknown MAIL_PROVIDER "sendgrid".*smtp.*brevo.*resend/,
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
    jest.restoreAllMocks(); // undoes any jest.spyOn(nodemailer, 'createTransport') from a prior test
    mockedResolveCompanyMailSettings.mockReset();
    mockFetch.mockReset();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.BREVO_API_KEY;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("uses the company's own SMTP override when one is configured, never touching the instance provider", async () => {
    process.env.SMTP_HOST = 'instance-smtp.example.com'; // instance IS configured too — must be ignored
    const sendMailMock = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock } as never);

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
});
