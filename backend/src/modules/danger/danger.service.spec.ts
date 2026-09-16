/**
 * F-011 / F-012 — an operation must not report success it did not perform, and the code
 * authorising a destructive action must reach the person requesting it.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';
import { NO_MAIL_SERVER_CONFIGURED_MESSAGE } from '@/mail/mail.service';
import { DangerService } from './danger.service';

jest.mock('@/prisma/prisma.service', () => ({ __esModule: true, default: {} }));
jest.mock('@/logger/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const USER = { id: 'u1', email: 'requester@example.test' } as never;

function build() {
  const mailService = { sendForCompany: jest.fn().mockResolvedValue(undefined) };
  return { service: new DangerService(mailService as never), mailService };
}

describe('DangerService — F-012: the OTP reaches the requester', () => {
  it('sends the code to the requesting user, not to the instance mailbox', async () => {
    process.env.SMTP_FROM = 'noreply@the-instance.test';
    const { service, mailService } = build();

    await service.requestOtp(USER, 'co-1');

    const [companyId, { to, text }] = mailService.sendForCompany.mock.calls[0];
    expect(companyId).toBe('co-1');
    expect(to).toBe('requester@example.test');
    expect(to).not.toBe(process.env.SMTP_FROM);
    // The body must not announce a delivery that did not happen.
    expect(text).not.toContain('was sent to');
  });

  // The company → instance → named refusal cascade (`MailService#sendForCompany`) — this route is
  // OWNER-only and gated by the SAME active-company resolution `resetApp`/`resetAll` already require,
  // so the OTP now goes out through the ACTIVE company's own mail server, never straight to the
  // instance-level `sendMail`.
  it("threads the active company's own id through to sendForCompany, never a hardcoded or missing one", async () => {
    const { service, mailService } = build();

    await service.requestOtp(USER, 'company-42');

    expect(mailService.sendForCompany).toHaveBeenCalledWith('company-42', expect.any(Object));
  });

  it(
    'rethrows the NAMED "no mail server configured" refusal VERBATIM — never the generic ' +
      '"check your SMTP configuration" wrapper',
    async () => {
      const mailService = {
        sendForCompany: jest
          .fn()
          .mockRejectedValue(new BadRequestException(NO_MAIL_SERVER_CONFIGURED_MESSAGE)),
      };
      const service = new DangerService(mailService as never);

      const action = service.requestOtp(USER, 'co-1');

      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      await expect(action).rejects.toThrow(NO_MAIL_SERVER_CONFIGURED_MESSAGE);
    },
  );

  it('collapses any OTHER provider error into the generic message — never the raw provider error', async () => {
    const mailService = { sendForCompany: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const service = new DangerService(mailService as never);

    await expect(service.requestOtp(USER, 'co-1')).rejects.toThrow(
      'Failed to send OTP email. Please check your SMTP configuration.',
    );
  });
});

describe('DangerService — F-011: resetAll does not claim a deletion it never performs', () => {
  it('throws NotImplementedException instead of returning success', async () => {
    const { service, mailService } = build();
    await service.requestOtp(USER, 'co-1');
    const otp = (mailService.sendForCompany.mock.calls[0][1].text as string).match(/is: (\d+)/)![1];

    await expect(service.resetAll(USER, 'co-1', otp)).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('still rejects an invalid code before anything else', async () => {
    const { service } = build();
    await expect(service.resetAll(USER, 'co-1', '00000000')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('consumes the code: a second use of the same OTP is refused', async () => {
    const { service, mailService } = build();
    await service.requestOtp(USER, 'co-1');
    const otp = (mailService.sendForCompany.mock.calls[0][1].text as string).match(/is: (\d+)/)![1];

    await expect(service.resetAll(USER, 'co-1', otp)).rejects.toBeInstanceOf(NotImplementedException);
    // resetAll clears the OTP before throwing, so replaying it must now fail the code check.
    await expect(service.resetAll(USER, 'co-1', otp)).rejects.toBeInstanceOf(BadRequestException);
  });
});
