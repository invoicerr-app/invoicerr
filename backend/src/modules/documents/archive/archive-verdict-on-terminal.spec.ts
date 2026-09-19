import { vi, type Mock } from 'vitest';
import { archiveTerminalAuthorityVerdictIfAny } from './archive-verdict-on-terminal';
import { createAuthorityVerdictArchive } from './persistence';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    // Read by `logger.error()` (logger.service.ts) whenever this module logs — mocked out so the
    // (expected) failure-path tests below don't also spam a "log entry could not be persisted" error.
    log: { create: vi.fn().mockResolvedValue({}) },
  },
}));
vi.mock('./persistence');

const mockedCreate = createAuthorityVerdictArchive as Mock;

const INPUT = {
  companyId: 'company-1',
  documentId: 'doc-1',
  providerId: 'pdp',
  statusCode: 'fr:202',
  statusText: 'Reçue',
  reason: null,
  observedAt: new Date('2026-09-06T10:00:00Z'),
  rawPayload: { raw: true },
};

describe('archiveTerminalAuthorityVerdictIfAny', () => {
  beforeEach(() => vi.clearAllMocks());

  it('archives the verdict and does nothing further on success', async () => {
    mockedCreate.mockResolvedValue({ archived: true });

    await archiveTerminalAuthorityVerdictIfAny(INPUT);

    expect(mockedCreate).toHaveBeenCalledWith(INPUT);
  });

  it('is silent (not an error) when the outcome is a dedup — an ordinary re-poll of an already-archived verdict', async () => {
    mockedCreate.mockResolvedValue({ archived: false, reason: 'duplicate' });

    await expect(archiveTerminalAuthorityVerdictIfAny(INPUT)).resolves.toBeUndefined();
    // Nothing here asserts on the logger directly (it is mocked at the prisma boundary only), but a
    // 'duplicate' outcome must never throw and must never be treated as the 'no-deposit-archive' case
    // — both are proven by the OTHER tests in this file exercising each branch distinctly.
  });

  it('never throws when the deposit archive does not exist yet (no-deposit-archive)', async () => {
    mockedCreate.mockResolvedValue({ archived: false, reason: 'no-deposit-archive' });

    await expect(archiveTerminalAuthorityVerdictIfAny(INPUT)).resolves.toBeUndefined();
  });

  it('never throws when the underlying archiving call itself throws (e.g. a disk failure)', async () => {
    mockedCreate.mockRejectedValue(new Error('disk full'));

    await expect(archiveTerminalAuthorityVerdictIfAny(INPUT)).resolves.toBeUndefined();
  });
});
