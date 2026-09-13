/**
 * AtcudSeriesService in isolation — mocks `@/prisma/prisma.service` at its own entry point, the same
 * discipline `signing-certificates.service.spec.ts` already holds for its own service. No encryption
 * to exercise here (see this file's own service header on why the validation code is stored in the
 * clear) — this proves the upsert validation (length + shape), the tenant-scoped delete, and the
 * plain list/response shape.
 */
import prisma from '@/prisma/prisma.service';

import { AtcudSeriesService } from './atcud-series.service';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companyAtcudSeries: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  companyAtcudSeries: {
    findMany: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
};

const COMPANY_ID = 'company-1';

beforeEach(() => jest.clearAllMocks());

describe('AtcudSeriesService.listForCompany', () => {
  it('returns every row for this company, validation code included in full (not a secret)', async () => {
    const row = {
      id: 'series-1',
      companyId: COMPANY_ID,
      typeId: 'invoice',
      seriesId: 'FT 2026',
      validationCode: 'JCVPTS0J',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    };
    mockedPrisma.companyAtcudSeries.findMany.mockResolvedValue([row]);

    const service = new AtcudSeriesService();
    const result = await service.listForCompany(COMPANY_ID);

    expect(result).toEqual([row]);
    expect(mockedPrisma.companyAtcudSeries.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: COMPANY_ID } }),
    );
  });
});

describe('AtcudSeriesService.upsert', () => {
  it('stores a valid code, upserting on [companyId, typeId, seriesId]', async () => {
    const stored = {
      id: 'series-1',
      companyId: COMPANY_ID,
      typeId: 'invoice',
      seriesId: 'FT 2026',
      validationCode: 'JCVPTS0J',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockedPrisma.companyAtcudSeries.upsert.mockResolvedValue(stored);

    const service = new AtcudSeriesService();
    const result = await service.upsert(COMPANY_ID, {
      typeId: 'invoice',
      seriesId: 'FT 2026',
      validationCode: 'JCVPTS0J',
    });

    expect(result).toEqual(stored);
    expect(mockedPrisma.companyAtcudSeries.upsert).toHaveBeenCalledWith({
      where: {
        companyId_typeId_seriesId: { companyId: COMPANY_ID, typeId: 'invoice', seriesId: 'FT 2026' },
      },
      create: { companyId: COMPANY_ID, typeId: 'invoice', seriesId: 'FT 2026', validationCode: 'JCVPTS0J' },
      update: expect.objectContaining({ validationCode: 'JCVPTS0J' }),
    });
  });

  it('trims whitespace on every field before validating/storing', async () => {
    mockedPrisma.companyAtcudSeries.upsert.mockResolvedValue({
      id: 'series-1',
      companyId: COMPANY_ID,
      typeId: 'invoice',
      seriesId: 'FT 2026',
      validationCode: 'JCVPTS0J',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = new AtcudSeriesService();
    await service.upsert(COMPANY_ID, {
      typeId: '  invoice  ',
      seriesId: '  FT 2026  ',
      validationCode: '  JCVPTS0J  ',
    });

    expect(mockedPrisma.companyAtcudSeries.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_typeId_seriesId: { companyId: COMPANY_ID, typeId: 'invoice', seriesId: 'FT 2026' },
        },
      }),
    );
  });

  it('rejects a validation code shorter than the legal minimum — never even reaches Prisma', async () => {
    const service = new AtcudSeriesService();
    await expect(
      service.upsert(COMPANY_ID, { typeId: 'invoice', seriesId: 'FT 2026', validationCode: 'SHORT1' }),
    ).rejects.toThrow(/at least 8 characters/);
    expect(mockedPrisma.companyAtcudSeries.upsert).not.toHaveBeenCalled();
  });

  it('rejects a validation code with non-alphanumeric characters', async () => {
    const service = new AtcudSeriesService();
    await expect(
      service.upsert(COMPANY_ID, { typeId: 'invoice', seriesId: 'FT 2026', validationCode: 'JCVP<S0J' }),
    ).rejects.toThrow(/letters and digits/);
    expect(mockedPrisma.companyAtcudSeries.upsert).not.toHaveBeenCalled();
  });

  it('rejects an empty typeId/seriesId/validationCode', async () => {
    const service = new AtcudSeriesService();
    await expect(
      service.upsert(COMPANY_ID, { typeId: '', seriesId: 'FT 2026', validationCode: 'JCVPTS0J' }),
    ).rejects.toThrow(/typeId is required/);
    await expect(
      service.upsert(COMPANY_ID, { typeId: 'invoice', seriesId: '  ', validationCode: 'JCVPTS0J' }),
    ).rejects.toThrow(/seriesId is required/);
    await expect(
      service.upsert(COMPANY_ID, { typeId: 'invoice', seriesId: 'FT 2026', validationCode: '  ' }),
    ).rejects.toThrow(/validationCode is required/);
  });
});

describe('AtcudSeriesService.remove', () => {
  it('deletes, scoped by BOTH id and companyId — a foreign company id matches nothing', async () => {
    mockedPrisma.companyAtcudSeries.deleteMany.mockResolvedValue({ count: 1 });

    const service = new AtcudSeriesService();
    const result = await service.remove(COMPANY_ID, 'series-1');

    expect(result).toEqual({ deleted: true });
    expect(mockedPrisma.companyAtcudSeries.deleteMany).toHaveBeenCalledWith({
      where: { id: 'series-1', companyId: COMPANY_ID },
    });
  });

  it('reports not-deleted when nothing matched', async () => {
    mockedPrisma.companyAtcudSeries.deleteMany.mockResolvedValue({ count: 0 });

    const service = new AtcudSeriesService();
    await expect(service.remove(COMPANY_ID, 'nonexistent')).resolves.toEqual({ deleted: false });
  });
});
