/**
 * `reportOnDocumentEvent`'s routing (issue #768): which obligations each document event fires, and
 * what it hands the classifier. The send path's own wiring and failure vocabulary stay covered by
 * `report-on-send.spec.ts`; the real Portuguese and French files by the last describe.
 */
import { vi, type Mock } from 'vitest';

import * as authorityEventsPersistence from '../conformity/authority-events.persistence';
import * as countryPolicy from '../country-policy/country-policy';
import { DeclarationOperation } from './classify';
import { defaultReportingObligationCatalogV2, ReportingObligationCatalogV2 } from './obligation-catalog';
import { ObligationTrigger, ReportingObligation } from './obligation-v2';
import { DocumentEvent, reportOnDocumentEvent } from './on-document-event';
import * as operationContext from './operation-context';
import { REPORT_BLOCKED_STATUS_CODE } from './report-job';

vi.mock('../country-policy/country-policy');
vi.mock('../conformity/authority-events.persistence');
vi.mock('./operation-context');

const mockedResolveCountry = countryPolicy.resolveCompanyCountryCode as Mock;
const mockedJournalSynthetic = authorityEventsPersistence.journalSyntheticEvent as Mock;
const mockedLoadOperation = operationContext.loadDeclarationOperation as Mock;

const obligation = (
  trigger: ObligationTrigger,
  overrides: Partial<ReportingObligation> = {},
): ReportingObligation => ({
  id: `zz-${trigger}`,
  authority: { countryCode: 'ZZ' },
  kind: 'data',
  trigger,
  scope: { documentTypes: ['invoice'] },
  legalBasis: { provenance: { kind: 'unverified', resolutionNote: 'fixture' } },
  channels: [{ dischargedBy: 'provider', id: `zz-${trigger}-api`, unit: 'document' }],
  ...overrides,
});
const catalogOf = (...obligations: ReportingObligation[]) =>
  new ReportingObligationCatalogV2([{ countryCode: 'ZZ', obligations }]);

const invoiceOperation: DeclarationOperation = {
  kind: 'invoice',
  sellerCountryCode: 'ZZ',
  buyerType: 'INDIVIDUAL',
  buyerCountryCode: 'ZZ',
  documentIssueDate: '2026-11-16',
  companyProfile: {},
  vatOnCollection: true,
  lineNatures: ['service'],
};
const payment = { paymentId: 'pay-1', amountMinor: 1200, paidAt: '2026-11-16' };

async function fire(event: DocumentEvent, catalog: ReportingObligationCatalogV2, typeId = 'invoice') {
  const enqueueReport = vi.fn().mockResolvedValue(true);
  await reportOnDocumentEvent(
    {
      event,
      companyId: 'company-1',
      typeId,
      documentId: 'doc-1',
      queueDispatcher: { enqueueAction: vi.fn(), enqueueReport },
      ...(event === 'payment' ? { payment } : {}),
    },
    catalog,
  );
  return enqueueReport;
}

describe('reportOnDocumentEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveCountry.mockResolvedValue('ZZ');
    mockedJournalSynthetic.mockResolvedValue(1);
    mockedLoadOperation.mockResolvedValue(invoiceOperation);
  });

  // THE MUTATION TARGET: an event that ignored the trigger would declare a payment on validation, or
  // the invoice again on every payment.
  it.each([
    ['issued', ['zz-issued-api']],
    ['sent', ['zz-issued-api', 'zz-sent-api']],
    ['payment', ['zz-payment-api']],
  ] as const)('a "%s" event fires exactly the obligations it triggers', async (event, expected) => {
    const fired: string[] = [];
    for (const trigger of ['issued', 'sent', 'payment'] as const) {
      const enqueueReport = await fire(event, catalogOf(obligation(trigger)));
      if (enqueueReport.mock.calls.length > 0) fired.push(enqueueReport.mock.calls[0][0].providerId);
    }
    expect(fired).toEqual(expected);
  });

  it('never fires a period-end obligation from a document event', async () => {
    const periodic = obligation('period-end', {
      timing: { period: 'quarter' },
      channels: [{ dischargedBy: 'provider', id: 'zz-period-api', unit: 'period' }],
    });
    for (const event of ['issued', 'sent', 'payment'] as const) {
      expect(await fire(event, catalogOf(periodic))).not.toHaveBeenCalled();
    }
  });

  it('an "issued" event of an unscoped obligation enqueues without reading the operation', async () => {
    const enqueueReport = await fire('issued', catalogOf(obligation('issued')));
    expect(enqueueReport).toHaveBeenCalledWith({
      companyId: 'company-1',
      documentId: 'doc-1',
      typeId: 'invoice',
      providerId: 'zz-issued-api',
    });
    expect(mockedLoadOperation).not.toHaveBeenCalled();
  });

  it('a "payment" event reads the payment operation and carries the payment id into the job', async () => {
    mockedLoadOperation.mockResolvedValue({ ...invoiceOperation, kind: 'payment', payment });
    const enqueueReport = await fire('payment', catalogOf(obligation('payment')));
    expect(mockedLoadOperation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'payment', payment: { amountMinor: 1200, paidAt: '2026-11-16' } }),
    );
    expect(enqueueReport).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'zz-payment-api', paymentId: 'pay-1' }),
    );
  });

  it('a "payment" event without its payment enqueues nothing and never throws', async () => {
    const enqueueReport = vi.fn();
    await expect(
      reportOnDocumentEvent(
        {
          event: 'payment',
          companyId: 'company-1',
          typeId: 'invoice',
          documentId: 'doc-1',
          queueDispatcher: { enqueueAction: vi.fn(), enqueueReport },
        },
        catalogOf(obligation('payment')),
      ),
    ).resolves.toBeUndefined();
    expect(enqueueReport).not.toHaveBeenCalled();
  });

  it('an "issued" event whose operation lacks the buyer type journals report:blocked, never a guess', async () => {
    mockedLoadOperation.mockResolvedValue({ ...invoiceOperation, buyerType: undefined });
    const scoped = obligation('issued', {
      scope: { documentTypes: ['invoice'], transactions: [{ transactions: 'b2c' }] },
    });
    const enqueueReport = await fire('issued', catalogOf(scoped));
    expect(enqueueReport).not.toHaveBeenCalled();
    expect(mockedJournalSynthetic).toHaveBeenCalledWith(
      'company-1',
      'doc-1',
      'zz-issued-api',
      REPORT_BLOCKED_STATUS_CODE,
      expect.any(String),
      undefined,
      '', // the document's own entry, not a payment's
    );
  });

  describe('the shipped country files', () => {
    it('a Portuguese invoice validated and never sent is declared to the AT', async () => {
      mockedResolveCountry.mockResolvedValue('PT');
      const enqueueReport = await fire('issued', defaultReportingObligationCatalogV2);
      expect(enqueueReport).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'pt-at' }));
    });

    it('a Portuguese payment declares nothing: the AT obligation covers the invoice, not its payments', async () => {
      mockedResolveCountry.mockResolvedValue('PT');
      expect(await fire('payment', defaultReportingObligationCatalogV2)).not.toHaveBeenCalled();
    });

    it('a French invoice validated without being sent declares nothing: France declares on transmission', async () => {
      mockedResolveCountry.mockResolvedValue('FR');
      expect(await fire('issued', defaultReportingObligationCatalogV2)).not.toHaveBeenCalled();
    });
  });
});
