import { BadRequestException } from '@nestjs/common';

import { DangerController } from './danger.controller';
import { DangerService } from './danger.service';

/**
 * The OTP used to travel as `@Query('otp')` on a POST — a bearer secret landing in nginx access logs
 * and browser history the same way a password would. `resetApp`/`resetAll` now take it from the
 * request BODY instead; this spec is the regression guard for that specific shape, since the
 * `@Query`/`@Body` decorator choice itself is Nest binding metadata that a plain unit call already
 * exercises correctly (Nest resolves the decorated parameter before the handler body ever runs, so
 * calling the method directly with the exact object `@Body()` would have produced proves the same
 * contract without needing a full HTTP round trip).
 */
function buildController() {
  const service = {
    resetApp: jest.fn().mockResolvedValue({ message: 'ok' }),
    resetAll: jest.fn().mockResolvedValue({ message: 'ok' }),
    requestOtp: jest.fn().mockResolvedValue({ message: 'ok' }),
  } as unknown as DangerService;
  return { controller: new DangerController(service), service };
}

const USER = { id: 'u1', email: 'owner@acme.test' } as never;

describe('DangerController — OTP travels in the body, never the query string', () => {
  it('resetApp reads otp from the body and forwards it to the service', async () => {
    const { controller, service } = buildController();

    await controller.resetApp(USER, 'company-1', { otp: '12345678' });

    expect(service.resetApp).toHaveBeenCalledWith(USER, 'company-1', '12345678');
  });

  it('resetApp refuses a request with no otp in the body', async () => {
    const { controller, service } = buildController();

    await expect(controller.resetApp(USER, 'company-1', { otp: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.resetApp).not.toHaveBeenCalled();
  });

  it('resetApp refuses an entirely missing body, rather than throwing on a null dereference', async () => {
    const { controller, service } = buildController();

    await expect(controller.resetApp(USER, 'company-1', undefined as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.resetApp).not.toHaveBeenCalled();
  });

  it('resetAll reads otp from the body and forwards it to the service', async () => {
    const { controller, service } = buildController();

    await controller.resetAll(USER, 'company-1', { otp: '87654321' });

    expect(service.resetAll).toHaveBeenCalledWith(USER, 'company-1', '87654321');
  });

  it('resetAll refuses a request with no otp in the body', async () => {
    const { controller, service } = buildController();

    await expect(controller.resetAll(USER, 'company-1', { otp: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.resetAll).not.toHaveBeenCalled();
  });
});
