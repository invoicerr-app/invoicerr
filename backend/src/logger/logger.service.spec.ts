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

import { LOG_PERSIST_FAILURE_THRESHOLD, logPersistenceHealth } from './log-persistence-health';
import { logger } from './logger.service';

const createLog = prisma.log.create as Mock;

describe('LoggerService — companyId resolution', () => {
  beforeEach(() => {
    createLog.mockReset();
    createLog.mockResolvedValue({ id: 'log-1' });
    logPersistenceHealth.reset();
  });

  it('outside any context, an omitted companyId resolves to null, the instance-level case', () => {
    logger.info('boot check', { category: 'documents' });
    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: null }) }),
    );
  });

  it('inside an active-company context, an omitted companyId inherits it automatically', () => {
    runWithCompanyId('company-1', () => logger.info('did something', { category: 'documents' }));
    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'company-1' }) }),
    );
  });

  it('an explicit companyId always wins over the ambient context', () => {
    runWithCompanyId('company-1', () =>
      logger.info('resolved a DIFFERENT company mid-function', {
        category: 'billing',
        companyId: 'company-2',
      }),
    );
    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'company-2' }) }),
    );
  });

  it('an explicit companyId: null outside any context is the legitimate instance-level shape', () => {
    logger.warn('mail provider misconfigured at boot', { category: 'mail', companyId: null });
    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: null }) }),
    );
  });

  it(
    'GUARD: forcing companyId: null while a company is genuinely active throws in test — the exact ' +
      'omission this mechanism exists to catch (a copy-pasted "instance" call site inside a company- ' +
      'scoped request/job)',
    () => {
      expect(() =>
        runWithCompanyId('company-1', () =>
          logger.error('oops, hardcoded null', { category: 'documents', companyId: null }),
        ),
      ).toThrow(/explicitly set companyId: null while company "company-1" was active/);
      // And the write never even reached Prisma — this fails LOUD, not silently-then-written.
      expect(createLog).not.toHaveBeenCalled();
    },
  );

  it('the guard never fires for the ordinary "just omit it" shape, even inside a context', () => {
    expect(() =>
      runWithCompanyId('company-1', () => logger.error('a real failure', { category: 'documents' })),
    ).not.toThrow();
  });

  it('the guard is inert outside NODE_ENV=test: production traffic is never taken down by it', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() =>
        runWithCompanyId('company-1', () =>
          logger.error('same mistake, but in production', { category: 'documents', companyId: null }),
        ),
      ).not.toThrow();
      expect(createLog).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ companyId: null }) }),
      );
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('hands back nothing to await, so no call site can leave a promise floating', () => {
    expect(logger.info('nothing to await', { category: 'documents' })).toBeUndefined();
  });

  it('a log write the database refuses never escapes as an unhandled rejection', async () => {
    createLog.mockRejectedValueOnce(new Error('relation "Log" does not exist'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      logger.error('the database is being rebuilt', { category: 'documents' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(createLog).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('audit() resolves only once its row is written', async () => {
    let written!: () => void;
    createLog.mockReturnValueOnce(new Promise((resolve) => (written = () => resolve({ id: 'log-1' }))));
    let settled = false;
    const pending = logger.audit('quote accepted', { category: 'documents' }).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    written();
    await pending;
    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ level: 'INFO', message: 'quote accepted' }),
      }),
    );
  });

  it('counts a failed log write on the health signal, without failing the caller', async () => {
    createLog.mockRejectedValueOnce(new Error('permission denied for table Log'));

    expect(() => logger.info('still served', { category: 'documents' })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logPersistenceHealth.snapshot()).toMatchObject({
      status: 'ok',
      failures: 1,
      consecutiveFailures: 1,
    });
  });

  it('reports degraded once log writes keep failing, still without failing the caller', async () => {
    createLog.mockRejectedValue(new Error('permission denied for table Log'));

    for (let i = 0; i < LOG_PERSIST_FAILURE_THRESHOLD; i++) {
      expect(() => logger.warn('dropped', { category: 'documents' })).not.toThrow();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logPersistenceHealth.snapshot()).toMatchObject({
      status: 'degraded',
      failures: LOG_PERSIST_FAILURE_THRESHOLD,
      consecutiveFailures: LOG_PERSIST_FAILURE_THRESHOLD,
    });
  });

  it('a successful write clears the failure streak but keeps the total', async () => {
    createLog.mockRejectedValueOnce(new Error('boom'));
    logger.error('failed', { category: 'documents' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    createLog.mockResolvedValueOnce({ id: 'log-2' });
    logger.info('written', { category: 'documents' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logPersistenceHealth.snapshot()).toMatchObject({ failures: 1, consecutiveFailures: 0 });
  });
});
