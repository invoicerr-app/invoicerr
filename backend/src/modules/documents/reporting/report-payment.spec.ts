import { vi, type Mock } from 'vitest';

import { journalSyntheticEvent } from '../conformity/authority-events.persistence';
import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { classifyObligation } from './classify';
import { ReportingObligationCatalogV2 } from './obligation-catalog';
import { REPORT_BLOCKED_STATUS_CODE, REPORT_FAILED_STATUS_CODE } from './report-job';
import { reportPaymentIfObligated } from './report-payment';

vi.mock('@/logger/logger.service', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../conformity/authority-events.persistence');
vi.mock('../country-policy/country-policy');
vi.mock('./operation-context', () => ({ loadDeclarationOperation: vi.fn().mockResolvedValue({}) }));
vi.mock('./classify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./classify')>()),
  classifyObligation: vi.fn(),
}));

const mockedJournal = journalSyntheticEvent as Mock;
const mockedCountry = resolveCompanyCountryCode as Mock;
const mockedClassify = classifyObligation as Mock;

// One payment obligation declared through the "fr-pa" provider (issue #768 moved the resolution to
// `on-document-event.ts`, which reads the v2 catalog).
const catalog = new ReportingObligationCatalogV2([
  {
    countryCode: 'XX',
    obligations: [
      {
        id: 'xx-payment',
        authority: { countryCode: 'XX' },
        kind: 'data',
        trigger: 'payment',
        scope: { documentTypes: ['invoice'] },
        legalBasis: { provenance: { kind: 'unverified', resolutionNote: 'fixture' } },
        channels: [{ dischargedBy: 'provider', id: 'fr-pa', unit: 'document' }],
      },
    ],
  },
]);

function input(paymentId: string, enqueueReport: Mock) {
  return {
    companyId: 'company-1',
    documentId: 'doc-1',
    paymentId,
    amountMinor: 5000,
    paidAt: '2026-09-10',
    queueDispatcher: { enqueueAction: vi.fn(), enqueueReport } as unknown as DocumentActionQueueDispatcher,
  };
}

describe('reportPaymentIfObligated - journal entries carry the payment id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCountry.mockResolvedValue('XX');
    mockedJournal.mockResolvedValue(1);
  });

  it('an enqueue failure is journaled report:failed under that payment', async () => {
    mockedClassify.mockReturnValue({ status: 'in' });
    const enqueueReport = vi.fn().mockRejectedValue(new Error('redis down'));

    await reportPaymentIfObligated(input('payment-2', enqueueReport), catalog);

    expect(mockedJournal).toHaveBeenCalledWith(
      'company-1',
      'doc-1',
      'fr-pa',
      REPORT_FAILED_STATUS_CODE,
      expect.stringContaining('redis down'),
      undefined,
      'payment-2',
    );
  });

  it('an undetermined obligation is journaled report:blocked under that payment', async () => {
    mockedClassify.mockReturnValue({ status: 'undetermined', reason: 'profile incomplete' });
    const enqueueReport = vi.fn();

    await reportPaymentIfObligated(input('payment-3', enqueueReport), catalog);

    expect(enqueueReport).not.toHaveBeenCalled();
    expect(mockedJournal).toHaveBeenCalledWith(
      'company-1',
      'doc-1',
      'fr-pa',
      REPORT_BLOCKED_STATUS_CODE,
      'profile incomplete',
      undefined,
      'payment-3',
    );
  });
});
