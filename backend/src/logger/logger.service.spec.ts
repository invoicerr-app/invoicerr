/**
 * `LoggerService#createLog`'s `companyId` resolution — the write-side half of `Log.companyId`
 * (`schema.prisma`'s own comment on the column, `@/lib/request-context.ts` for the read side). Real
 * `AsyncLocalStorage` (`runWithCompanyId`), mocked `prisma.log.create` only.
 */

import { vi, type Mock } from 'vitest';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { log: { create: vi.fn() } },
}));

import prisma from '@/prisma/prisma.service';
import { runWithCompanyId } from '@/lib/request-context';

import { logger } from './logger.service';

const createLog = prisma.log.create as Mock;

describe('LoggerService — companyId resolution', () => {
  beforeEach(() => {
    createLog.mockReset();
    createLog.mockResolvedValue({ id: 'log-1' });
  });

  it('outside any context, an omitted companyId resolves to null — the instance-level case', async () => {
    await logger.info('boot check', { category: 'documents' });
    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: null }) }),
    );
  });

  it('inside an active-company context, an omitted companyId inherits it automatically', async () => {
    await runWithCompanyId('company-1', () => logger.info('did something', { category: 'documents' }));
    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'company-1' }) }),
    );
  });

  it('an explicit companyId always wins over the ambient context', async () => {
    await runWithCompanyId('company-1', () =>
      logger.info('resolved a DIFFERENT company mid-function', {
        category: 'billing',
        companyId: 'company-2',
      }),
    );
    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'company-2' }) }),
    );
  });

  it('an explicit companyId: null outside any context is the legitimate instance-level shape', async () => {
    await logger.warn('mail provider misconfigured at boot', { category: 'mail', companyId: null });
    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: null }) }),
    );
  });

  it(
    'GUARD: forcing companyId: null while a company is genuinely active throws in test — the exact ' +
      'omission this mechanism exists to catch (a copy-pasted "instance" call site inside a company- ' +
      'scoped request/job)',
    async () => {
      await expect(
        runWithCompanyId('company-1', () =>
          logger.error('oops, hardcoded null', { category: 'documents', companyId: null }),
        ),
      ).rejects.toThrow(/explicitly set companyId: null while company "company-1" was active/);
      // And the write never even reached Prisma — this fails LOUD, not silently-then-written.
      expect(createLog).not.toHaveBeenCalled();
    },
  );

  it('the guard never fires for the ordinary "just omit it" shape, even inside a context', async () => {
    await expect(
      runWithCompanyId('company-1', () => logger.error('a real failure', { category: 'documents' })),
    ).resolves.not.toThrow();
  });

  it('the guard is inert outside NODE_ENV=test — production traffic is never taken down by it', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(
        runWithCompanyId('company-1', () =>
          logger.error('same mistake, but in production', { category: 'documents', companyId: null }),
        ),
      ).resolves.not.toThrow();
      expect(createLog).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ companyId: null }) }),
      );
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
