/**
 * `reportOnSendIfObligated`'s own WIRING — "does the trigger react correctly to a country's
 * obligation", never "is HU's own obligation real" (that is `registry.spec.ts`'s job). Same
 * "mock `country-policy/country-policy` wholesale" discipline `actions/invoice-channel-mandate.spec.ts`
 * already holds for the identical dependency.
 */
import { vi, type Mock } from 'vitest';

import * as authorityEventsPersistence from '../conformity/authority-events.persistence';
import * as countryPolicy from '../country-policy/country-policy';
import { REPORT_FAILED_STATUS_CODE } from './report-job';
import { ReportingObligationCatalogV2 } from './obligation-catalog';
import { ReportingObligation } from './obligation-v2';
import * as operationContext from './operation-context';
import { reportOnSendIfObligated } from './report-on-send';

vi.mock('../country-policy/country-policy');
vi.mock('../conformity/authority-events.persistence');
// Real by default, so every test written before the v2 describe below keeps reading the operation
// exactly as it did; only that describe gives it a value.
vi.mock('./operation-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./operation-context')>();
  return { ...actual, loadDeclarationOperation: vi.fn(actual.loadDeclarationOperation) };
});

const mockedResolveCountry = countryPolicy.resolveCompanyCountryCode as Mock;
const mockedJournalSynthetic = authorityEventsPersistence.journalSyntheticEvent as Mock;
const mockedLoadOperation = operationContext.loadDeclarationOperation as Mock;

const fixtureCatalog = new ReportingObligationCatalogV2([
  {
    countryCode: 'HU',
    facts: [
      {
        providerId: 'nav',
        appliesTo: 'invoice',
        dischargedBy: 'provider',
        provenance: { kind: 'legal', sourceText: 'fixture', sourceCheckedAt: '2026-09-02' },
      },
    ],
  },
]);

// The real shape France's own `countries/data/fr.json (section "reporting")` ships — a transport-discharged fact AND a
// scope-restricted one, both for "invoice" — used by the two dedicated tests below to prove the
// TRIGGER itself never fires for either, independently of `registry.spec.ts`'s own unit coverage of
// `obligationFor`'s filter.
const frShapedCatalog = new ReportingObligationCatalogV2([
  {
    countryCode: 'FR',
    facts: [
      {
        providerId: 'pdp',
        appliesTo: 'invoice',
        dischargedBy: 'transport',
        scope: [{ transactions: 'b2b-domestic' }],
        provenance: { kind: 'legal', sourceText: 'fixture: CGI art. 289 E', sourceCheckedAt: '2026-09-16' },
      },
      {
        providerId: 'fr-pa',
        appliesTo: 'invoice',
        dischargedBy: 'provider',
        scope: [{ transactions: 'b2c' }, { transactions: 'international' }],
        provenance: { kind: 'unverified', resolutionNote: 'fixture: CGI art. 290' },
      },
    ],
  },
]);

// A v2-only obligation (issue #767): the legacy fact shape could not say any of this. Built once and
// varied per test, so each test names the one field it is about.
const v2Obligation: ReportingObligation = {
  id: 'zz-data',
  authority: { countryCode: 'ZZ' },
  kind: 'data',
  trigger: 'sent',
  scope: { documentTypes: ['invoice', 'credit-note'] },
  legalBasis: { provenance: { kind: 'unverified', resolutionNote: 'fixture' } },
  channels: [
    { dischargedBy: 'export', id: 'zz-file', unit: 'document' },
    { dischargedBy: 'provider', id: 'zz-api', unit: 'document' },
  ],
};
const v2Catalog = (obligation: ReportingObligation) =>
  new ReportingObligationCatalogV2([{ countryCode: 'ZZ', obligations: [obligation] }]);

describe('reportOnSendIfObligated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedJournalSynthetic.mockResolvedValue(1);
  });

  // THE MUTATION TARGET the task's own brief names: a trigger that declares for EVERY country (not
  // only one with a shipped fact) would make this test fail — the seller is French, `factsFor('FR')`
  // on the fixture catalog is empty, and `enqueueReport` must never be called.
  it('a French invoice-seller: nothing is enqueued at all — "pays sans obligation, rien ne change"', async () => {
    mockedResolveCountry.mockResolvedValue('FR');
    const enqueueReport = vi.fn().mockResolvedValue(true);
    const enqueueAction = vi.fn();

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction, enqueueReport },
      },
      fixtureCatalog,
    );

    expect(enqueueReport).not.toHaveBeenCalled();
  });

  it('a Hungarian invoice-seller: a report job is enqueued for "nav", carrying the right ids', async () => {
    mockedResolveCountry.mockResolvedValue('HU');
    const enqueueReport = vi.fn().mockResolvedValue(true);
    const enqueueAction = vi.fn();

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction, enqueueReport },
      },
      fixtureCatalog,
    );

    expect(enqueueReport).toHaveBeenCalledTimes(1);
    expect(enqueueReport).toHaveBeenCalledWith({
      companyId: 'company-1',
      documentId: 'doc-1',
      typeId: 'invoice',
      providerId: 'nav',
    });
  });

  // THE MUTATION TARGET this fixture exists for: a trigger that fires on ANY fact matching
  // `appliesTo`, ignoring `dischargedBy`, would enqueue a report job under "pdp" here — wrongly, since
  // the PDP transport itself (never this mechanism) is what the law makes responsible for a
  // B2B-domestic French invoice (CGI art. 289 E).
  it('a French invoice-seller with a "transport"-discharged fact: nothing is enqueued — the transport already carries it', async () => {
    mockedResolveCountry.mockResolvedValue('FR');
    const enqueueReport = vi.fn().mockResolvedValue(true);

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction: vi.fn(), enqueueReport },
      },
      frShapedCatalog,
    );

    expect(enqueueReport).not.toHaveBeenCalled();
  });

  // THE MUTATION TARGET here: a trigger that ignores `scope` would fire "fr-pa" on EVERY
  // French invoice — including a B2B-domestic one already covered by the transport fact above — with
  // no way to know from `(companyId, typeId, documentId)` alone whether THIS invoice is actually B2C
  // or international. Nothing enqueues until that classifier exists (see `registry.ts#obligationFor`).
  it('a French invoice-seller with only scope-restricted "provider" facts: nothing is enqueued either', async () => {
    mockedResolveCountry.mockResolvedValue('FR');
    const enqueueReport = vi.fn().mockResolvedValue(true);
    const scopedOnlyCatalog = new ReportingObligationCatalogV2([
      {
        countryCode: 'FR',
        obligations: [frShapedCatalog.obligationsFor('FR')[1]],
      },
    ]);

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction: vi.fn(), enqueueReport },
      },
      scopedOnlyCatalog,
    );

    expect(enqueueReport).not.toHaveBeenCalled();
  });

  it('a Hungarian seller but a document TYPE the fact does not apply to: nothing is enqueued', async () => {
    mockedResolveCountry.mockResolvedValue('HU');
    const enqueueReport = vi.fn().mockResolvedValue(true);

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'credit-note',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction: vi.fn(), enqueueReport },
      },
      fixtureCatalog,
    );

    expect(enqueueReport).not.toHaveBeenCalled();
  });

  it('an unresolvable seller country: nothing is enqueued, never a guess', async () => {
    mockedResolveCountry.mockResolvedValue(undefined);
    const enqueueReport = vi.fn().mockResolvedValue(true);

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction: vi.fn(), enqueueReport },
      },
      fixtureCatalog,
    );

    expect(enqueueReport).not.toHaveBeenCalled();
  });

  it('a dispatcher with no enqueueReport at all (every pre-existing bare mock): no crash, no effect', async () => {
    mockedResolveCountry.mockResolvedValue('HU');

    await expect(
      reportOnSendIfObligated(
        {
          companyId: 'company-1',
          typeId: 'invoice',
          documentId: 'doc-1',
          queueDispatcher: { enqueueAction: vi.fn() },
        },
        fixtureCatalog,
      ),
    ).resolves.toBeUndefined();
  });

  // "never silent… but never blocking" for the ENQUEUE call itself: a failure here must never
  // throw past this function (mirrors `archiveDeliveredArtifactsIfAny`'s own guarantee).
  it('never throws even when enqueueReport itself rejects', async () => {
    mockedResolveCountry.mockResolvedValue('HU');
    const enqueueReport = vi.fn().mockRejectedValue(new Error('Redis is down'));

    await expect(
      reportOnSendIfObligated(
        {
          companyId: 'company-1',
          typeId: 'invoice',
          documentId: 'doc-1',
          queueDispatcher: { enqueueAction: vi.fn(), enqueueReport },
        },
        fixtureCatalog,
      ),
    ).resolves.toBeUndefined();
  });

  // THE MUTATION TARGET: an enqueue failure used to be logged ONLY — nothing on
  // `DocumentAuthorityEvent`, so the Declarations screen (`list-declarations.ts`, which reads ONLY
  // that table) showed nothing at all, not even a failure. This proves the lost declaration is now
  // JOURNALED, replayably, under the obligation's own real providerId ("nav") — never a made-up one
  // `list-declarations.ts`'s own `providerId: { in: declarationProviderIds() }` filter would exclude.
  it('journals REPORT_FAILED_STATUS_CODE under the obligation’s own providerId when enqueueReport itself rejects', async () => {
    mockedResolveCountry.mockResolvedValue('HU');
    const enqueueReport = vi.fn().mockRejectedValue(new Error('Redis is down'));

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction: vi.fn(), enqueueReport },
      },
      fixtureCatalog,
    );

    expect(mockedJournalSynthetic).toHaveBeenCalledWith(
      'company-1',
      'doc-1',
      'nav',
      REPORT_FAILED_STATUS_CODE,
      expect.stringContaining('Redis is down'),
    );
  });

  // BELT AND SUSPENDERS — the same posture `conformity-sweep-runner.ts#runPoll`'s own compensating
  // write and `reporting-runner.ts#recordTerminalFailure` both hold: the fallback journal itself is not
  // guaranteed to succeed either, and that must not crash this function.
  it('never throws even when journaling the enqueue failure itself also fails', async () => {
    mockedResolveCountry.mockResolvedValue('HU');
    const enqueueReport = vi.fn().mockRejectedValue(new Error('Redis is down'));
    mockedJournalSynthetic.mockRejectedValue(new Error('db unreachable'));

    await expect(
      reportOnSendIfObligated(
        {
          companyId: 'company-1',
          typeId: 'invoice',
          documentId: 'doc-1',
          queueDispatcher: { enqueueAction: vi.fn(), enqueueReport },
        },
        fixtureCatalog,
      ),
    ).resolves.toBeUndefined();
  });

  it('never journals anything when enqueueReport succeeds — only a genuine failure is worth a row', async () => {
    mockedResolveCountry.mockResolvedValue('HU');
    const enqueueReport = vi.fn().mockResolvedValue(true);

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction: vi.fn(), enqueueReport },
      },
      fixtureCatalog,
    );

    expect(mockedJournalSynthetic).not.toHaveBeenCalled();
  });

  it('never throws even when resolving the country itself rejects', async () => {
    mockedResolveCountry.mockRejectedValue(new Error('DB unreachable'));
    const enqueueReport = vi.fn();

    await expect(
      reportOnSendIfObligated(
        {
          companyId: 'company-1',
          typeId: 'invoice',
          documentId: 'doc-1',
          queueDispatcher: { enqueueAction: vi.fn(), enqueueReport },
        },
        fixtureCatalog,
      ),
    ).resolves.toBeUndefined();
    expect(enqueueReport).not.toHaveBeenCalled();
    // No `providerId` was ever resolved at this point — nothing meaningful to journal a lost
    // declaration against, unlike the enqueue-failure case above.
    expect(mockedJournalSynthetic).not.toHaveBeenCalled();
  });

  describe('v2 obligations (issue #767)', () => {
    const send = (catalog: ReportingObligationCatalogV2, typeId = 'invoice') => {
      const enqueueReport = vi.fn().mockResolvedValue(true);
      return reportOnSendIfObligated(
        {
          companyId: 'company-1',
          typeId,
          documentId: 'doc-1',
          queueDispatcher: { enqueueAction: vi.fn(), enqueueReport },
        },
        catalog,
      ).then(() => enqueueReport);
    };

    beforeEach(() => mockedResolveCountry.mockResolvedValue('ZZ'));

    it('enqueues under the id of the provider channel, never another channel of the same obligation', async () => {
      const enqueueReport = await send(v2Catalog(v2Obligation));
      expect(enqueueReport).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'zz-api' }));
    });

    it('fires for every document type the obligation lists', async () => {
      const enqueueReport = await send(v2Catalog(v2Obligation), 'credit-note');
      expect(enqueueReport).toHaveBeenCalledWith(
        expect.objectContaining({ typeId: 'credit-note', providerId: 'zz-api' }),
      );
    });

    // THE MUTATION TARGET: a send trigger that ignored `trigger` would declare a periodic summary once
    // per invoice. Only a `sent` obligation is a send-time declaration.
    it.each([
      'period-end',
      'payment',
      'issued',
    ] as const)('never fires a "%s" obligation on send', async (trigger) => {
      // A period-end obligation is declared per period, so the validator requires its channels to say so.
      const periodic =
        trigger === 'period-end'
          ? {
              timing: { period: 'quarter' as const },
              channels: v2Obligation.channels.map((c) => ({ ...c, unit: 'period' as const })),
            }
          : {};
      const enqueueReport = await send(v2Catalog({ ...v2Obligation, trigger, ...periodic }));
      expect(enqueueReport).not.toHaveBeenCalled();
      expect(mockedJournalSynthetic).not.toHaveBeenCalled();
    });

    it('never fires an obligation with no provider channel', async () => {
      const enqueueReport = await send(v2Catalog({ ...v2Obligation, channels: [v2Obligation.channels[0]] }));
      expect(enqueueReport).not.toHaveBeenCalled();
    });

    // `until` is v2-only: a closed window must stop the declaration, never be read as open-ended.
    it('a window that closed before the document date is out: nothing enqueued, nothing journaled', async () => {
      mockedLoadOperation.mockResolvedValueOnce({
        kind: 'invoice',
        documentIssueDate: '2027-01-01',
        companyProfile: {},
        vatOnCollection: true,
      });
      const enqueueReport = await send(
        v2Catalog({
          ...v2Obligation,
          applicability: [
            {
              from: '2026-01-01',
              until: '2026-12-31',
              provenance: { kind: 'unverified', resolutionNote: 'f' },
            },
          ],
        }),
      );
      expect(mockedLoadOperation).toHaveBeenCalled();
      expect(enqueueReport).not.toHaveBeenCalled();
      expect(mockedJournalSynthetic).not.toHaveBeenCalled();
    });
  });
});
