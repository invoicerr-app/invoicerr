/**
 * F-011 / F-012 — an operation must not report success it did not perform, and the code
 * authorising a destructive action must reach the person requesting it.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';
import { DangerService } from './danger.service';

jest.mock('@/prisma/prisma.service', () => ({ __esModule: true, default: {} }));
jest.mock('@/logger/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const USER = { id: 'u1', email: 'requester@example.test' } as never;

function build() {
  const mailService = { sendMail: jest.fn().mockResolvedValue(undefined) };
  return { service: new DangerService(mailService as never), mailService };
}

describe('DangerService — F-012: the OTP reaches the requester', () => {
  it('sends the code to the requesting user, not to the instance mailbox', async () => {
    process.env.SMTP_FROM = 'noreply@the-instance.test';
    const { service, mailService } = build();

    await service.requestOtp(USER);

    const [{ to, text }] = mailService.sendMail.mock.calls[0];
    expect(to).toBe('requester@example.test');
    expect(to).not.toBe(process.env.SMTP_FROM);
    // The body must not announce a delivery that did not happen.
    expect(text).not.toContain('was sent to');
  });
});

describe('DangerService — F-011: resetAll does not claim a deletion it never performs', () => {
  it('throws NotImplementedException instead of returning success', async () => {
    const { service, mailService } = build();
    await service.requestOtp(USER);
    const otp = (mailService.sendMail.mock.calls[0][0].text as string).match(/is: (\d+)/)![1];

    await expect(service.resetAll(USER, 'co-1', otp)).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('still rejects an invalid code before anything else', async () => {
    const { service } = build();
    await expect(service.resetAll(USER, 'co-1', '00000000')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('consumes the code: a second use of the same OTP is refused', async () => {
    const { service, mailService } = build();
    await service.requestOtp(USER);
    const otp = (mailService.sendMail.mock.calls[0][0].text as string).match(/is: (\d+)/)![1];

    await expect(service.resetAll(USER, 'co-1', otp)).rejects.toBeInstanceOf(NotImplementedException);
    // resetAll clears the OTP before throwing, so replaying it must now fail the code check.
    await expect(service.resetAll(USER, 'co-1', otp)).rejects.toBeInstanceOf(BadRequestException);
  });
});
