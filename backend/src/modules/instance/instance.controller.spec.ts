import { BadRequestException } from '@nestjs/common';

import { InstanceController } from './instance.controller';
import { InstancePreflightService, InstancePreflightView } from './instance-preflight.service';
import { InstanceResetService } from './instance-reset.service';

const USER = { id: 'u1', email: 'ops@example.test' } as never;

function build() {
  const preflightView: InstancePreflightView = { companies: 2, users: 3, documents: 40 };
  const preflightService = {
    getPreflight: jest.fn().mockResolvedValue(preflightView),
  } as unknown as InstancePreflightService;
  const resetService = {
    requestOtp: jest.fn().mockResolvedValue({ message: 'OTP sent successfully' }),
    reset: jest.fn().mockResolvedValue({ message: 'Instance reset successfully' }),
  } as unknown as InstanceResetService;
  return {
    controller: new InstanceController(preflightService, resetService),
    preflightService,
    resetService,
  };
}

describe('instance/InstanceController', () => {
  it('delegates GET .../danger/preflight straight to InstancePreflightService', async () => {
    const { controller, preflightService } = build();
    const result = await controller.getPreflight();
    expect(preflightService.getPreflight).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ companies: 2, users: 3, documents: 40 });
  });

  it('delegates POST .../danger/otp to InstanceResetService with the requesting user', async () => {
    const { controller, resetService } = build();
    await controller.requestOtp(USER);
    expect(resetService.requestOtp).toHaveBeenCalledWith(USER);
  });

  it('requires an OTP in the body before calling the service', async () => {
    const { controller, resetService } = build();
    await expect(
      controller.reset(USER, { otp: '', confirmationWord: 'RESET INSTANCE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(resetService.reset).not.toHaveBeenCalled();
  });

  it('requires a confirmation word in the body before calling the service', async () => {
    const { controller, resetService } = build();
    await expect(controller.reset(USER, { otp: '12345678', confirmationWord: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(resetService.reset).not.toHaveBeenCalled();
  });

  it('passes the OTP and confirmation word through to the service — from the BODY only', async () => {
    const { controller, resetService } = build();
    await controller.reset(USER, { otp: '12345678', confirmationWord: 'RESET INSTANCE' });
    expect(resetService.reset).toHaveBeenCalledWith(USER, '12345678', 'RESET INSTANCE');
  });
});
