/**
 * `SmtpMailProvider` in isolation — mocked `nodemailer.createTransport` (same discipline
 * `mail.service.spec.ts` already holds for the same reason: a real ESM module namespace is frozen
 * under Vitest, so the module is mocked wholesale rather than spied on). Proves this class forwards
 * `options.replyTo` to nodemailer's own `replyTo` field verbatim — the cascade decision itself
 * (explicit > company > instance `MAIL_REPLY_TO`) is `mail.service.ts`'s job, proven in
 * `mail.service.spec.ts`; this file only proves this ONE provider does not drop or reinterpret the
 * value it is handed.
 */

import { vi, type Mock } from 'vitest';

import * as nodemailer from 'nodemailer';

import { SmtpMailProvider } from './smtp.provider';

vi.mock('nodemailer', () => ({ createTransport: vi.fn() }));

describe('SmtpMailProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_USER;
  });

  it('forwards options.replyTo to nodemailer as-is', async () => {
    const sendMailMock = vi.fn().mockResolvedValue(undefined);
    (nodemailer.createTransport as Mock).mockReturnValue({ sendMail: sendMailMock } as never);

    const provider = new SmtpMailProvider();
    await provider.sendMail({
      to: 'client@example.com',
      subject: 'Hi',
      replyTo: 'support@company.example.com',
    });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: 'support@company.example.com' }),
    );
  });

  it('sends undefined (no Reply-To header), never a fabricated one, when the cascade resolved to nothing', async () => {
    const sendMailMock = vi.fn().mockResolvedValue(undefined);
    (nodemailer.createTransport as Mock).mockReturnValue({ sendMail: sendMailMock } as never);

    const provider = new SmtpMailProvider();
    await provider.sendMail({ to: 'client@example.com', subject: 'Hi' });

    expect(sendMailMock.mock.calls[0][0].replyTo).toBeUndefined();
  });
});
