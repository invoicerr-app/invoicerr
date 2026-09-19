import { vi } from 'vitest';

import { BadRequestException } from '@nestjs/common';

import { DangerController } from './danger.controller';
import { DangerService } from './danger.service';

/**
 * The OTP used to travel as `@Query('otp')` on a POST — a bearer secret landing in nginx access logs
 * and browser history the same way a password would. Every destructive action here takes it from the
 * request BODY instead; this spec is the regression guard for that specific shape, since the
 * `@Query`/`@Body` decorator choice itself is Nest binding metadata that a plain unit call already
 * exercises correctly (Nest resolves the decorated parameter before the handler body ever runs, so
 * calling the method directly with the exact object `@Body()` would have produced proves the same
 * contract without needing a full HTTP round trip).
 */
function buildController() {
  const service = {
    resetCompanyData: vi.fn().mockResolvedValue({ message: 'ok' }),
    deleteCompany: vi.fn().mockResolvedValue({ message: 'ok' }),
    requestOtp: vi.fn().mockResolvedValue({ message: 'ok' }),
    getCompanyDataResetPreflight: vi.fn().mockResolvedValue({
      blocked: false,
      retainedDocuments: 0,
      retentionUntil: null,
      counts: {
        documents: 0,
        clients: 0,
        articles: 0,
        projects: 0,
        timeEntries: 0,
        bankStatements: 0,
        archives: 0,
      },
    }),
  } as unknown as DangerService;
  return { controller: new DangerController(service), service };
}

const USER = { id: 'u1', email: 'owner@acme.test' } as never;

describe('DangerController — the preflight is a plain read, no OTP involved', () => {
  it('delegates straight to the service, scoped by the active company', async () => {
    const { controller, service } = buildController();

    await controller.getCompanyDataResetPreflight('company-1');

    expect(service.getCompanyDataResetPreflight).toHaveBeenCalledWith('company-1');
  });
});

describe('DangerController — OTP travels in the body, never the query string', () => {
  it('resetCompanyData reads otp from the body and forwards it to the service', async () => {
    const { controller, service } = buildController();

    await controller.resetCompanyData(USER, 'company-1', { otp: '12345678' });

    expect(service.resetCompanyData).toHaveBeenCalledWith(USER, 'company-1', '12345678');
  });

  it('resetCompanyData refuses a request with no otp in the body', async () => {
    const { controller, service } = buildController();

    await expect(controller.resetCompanyData(USER, 'company-1', { otp: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.resetCompanyData).not.toHaveBeenCalled();
  });

  it('resetCompanyData refuses an entirely missing body, rather than throwing on a null dereference', async () => {
    const { controller, service } = buildController();

    await expect(controller.resetCompanyData(USER, 'company-1', undefined as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.resetCompanyData).not.toHaveBeenCalled();
  });

  it('deleteCompany reads otp AND companyName from the body and forwards both to the service', async () => {
    const { controller, service } = buildController();

    await controller.deleteCompany(USER, 'company-1', { otp: '87654321', companyName: 'Acme Corp' });

    expect(service.deleteCompany).toHaveBeenCalledWith(USER, 'company-1', '87654321', 'Acme Corp');
  });

  it('deleteCompany refuses a request with no otp in the body', async () => {
    const { controller, service } = buildController();

    await expect(
      controller.deleteCompany(USER, 'company-1', { otp: '', companyName: 'Acme Corp' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.deleteCompany).not.toHaveBeenCalled();
  });

  it('deleteCompany refuses a request with no companyName in the body — the OTP alone is not enough', async () => {
    const { controller, service } = buildController();

    await expect(
      controller.deleteCompany(USER, 'company-1', { otp: '87654321', companyName: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.deleteCompany).not.toHaveBeenCalled();
  });
});
