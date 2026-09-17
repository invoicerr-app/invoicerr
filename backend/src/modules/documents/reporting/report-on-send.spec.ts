/**
 * `reportOnSendIfObligated`'s own WIRING — "does the trigger react correctly to a country's
 * obligation", never "is HU's own obligation real" (that is `registry.spec.ts`'s job). Same
 * "mock `country-policy/country-policy` wholesale" discipline `actions/invoice-channel-mandate.spec.ts`
 * already holds for the identical dependency.
 */
import * as authorityEventsPersistence from '../conformity/authority-events.persistence';
import * as countryPolicy from '../country-policy/country-policy';
import { REPORT_FAILED_STATUS_CODE } from './report-job';
import { ReportingObligationCatalog } from './registry';
import { reportOnSendIfObligated } from './report-on-send';

jest.mock('../country-policy/country-policy');
jest.mock('../conformity/authority-events.persistence');

const mockedResolveCountry = countryPolicy.resolveCompanyCountryCode as jest.Mock;
const mockedJournalSynthetic = authorityEventsPersistence.journalSyntheticEvent as jest.Mock;

const fixtureCatalog = new ReportingObligationCatalog([
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

// The real shape France's own `reporting/data/fr.json` ships — a transport-discharged fact AND a
// scope-restricted one, both for "invoice" — used by the two dedicated tests below to prove the
// TRIGGER itself never fires for either, independently of `registry.spec.ts`'s own unit coverage of
// `obligationFor`'s filter.
const frShapedCatalog = new ReportingObligationCatalog([
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
        providerId: 'fr-ereporting',
        appliesTo: 'invoice',
        dischargedBy: 'provider',
        scope: [{ transactions: 'b2c' }, { transactions: 'international' }],
        provenance: { kind: 'unverified', resolutionNote: 'fixture: CGI art. 290' },
      },
    ],
  },
]);

describe('reportOnSendIfObligated', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedJournalSynthetic.mockResolvedValue(1);
  });

  // THE MUTATION TARGET the task's own brief names: a trigger that declares for EVERY country (not
  // only one with a shipped fact) would make this test fail — the seller is French, `factsFor('FR')`
  // on the fixture catalog is empty, and `enqueueReport` must never be called.
  it('a French invoice-seller: nothing is enqueued at all — "pays sans obligation, rien ne change"', async () => {
    mockedResolveCountry.mockResolvedValue('FR');
    const enqueueReport = jest.fn().mockResolvedValue(true);
    const enqueueAction = jest.fn();

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
    const enqueueReport = jest.fn().mockResolvedValue(true);
    const enqueueAction = jest.fn();

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
    const enqueueReport = jest.fn().mockResolvedValue(true);

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction: jest.fn(), enqueueReport },
      },
      frShapedCatalog,
    );

    expect(enqueueReport).not.toHaveBeenCalled();
  });

  // THE MUTATION TARGET here: a trigger that ignores `scope` would fire "fr-ereporting" on EVERY
  // French invoice — including a B2B-domestic one already covered by the transport fact above — with
  // no way to know from `(companyId, typeId, documentId)` alone whether THIS invoice is actually B2C
  // or international. Nothing enqueues until that classifier exists (see `registry.ts#obligationFor`).
  it('a French invoice-seller with only scope-restricted "provider" facts: nothing is enqueued either', async () => {
    mockedResolveCountry.mockResolvedValue('FR');
    const enqueueReport = jest.fn().mockResolvedValue(true);
    const scopedOnlyCatalog = new ReportingObligationCatalog([
      {
        countryCode: 'FR',
        facts: [frShapedCatalog.factsFor('FR')[1]],
      },
    ]);

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction: jest.fn(), enqueueReport },
      },
      scopedOnlyCatalog,
    );

    expect(enqueueReport).not.toHaveBeenCalled();
  });

  it('a Hungarian seller but a document TYPE the fact does not apply to: nothing is enqueued', async () => {
    mockedResolveCountry.mockResolvedValue('HU');
    const enqueueReport = jest.fn().mockResolvedValue(true);

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'credit-note',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction: jest.fn(), enqueueReport },
      },
      fixtureCatalog,
    );

    expect(enqueueReport).not.toHaveBeenCalled();
  });

  it('an unresolvable seller country: nothing is enqueued, never a guess', async () => {
    mockedResolveCountry.mockResolvedValue(undefined);
    const enqueueReport = jest.fn().mockResolvedValue(true);

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction: jest.fn(), enqueueReport },
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
          queueDispatcher: { enqueueAction: jest.fn() },
        },
        fixtureCatalog,
      ),
    ).resolves.toBeUndefined();
  });

  // "never silent… but never blocking" for the ENQUEUE call itself: a failure here must never
  // throw past this function (mirrors `archiveDeliveredArtifactsIfAny`'s own guarantee).
  it('never throws even when enqueueReport itself rejects', async () => {
    mockedResolveCountry.mockResolvedValue('HU');
    const enqueueReport = jest.fn().mockRejectedValue(new Error('Redis is down'));

    await expect(
      reportOnSendIfObligated(
        {
          companyId: 'company-1',
          typeId: 'invoice',
          documentId: 'doc-1',
          queueDispatcher: { enqueueAction: jest.fn(), enqueueReport },
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
    const enqueueReport = jest.fn().mockRejectedValue(new Error('Redis is down'));

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction: jest.fn(), enqueueReport },
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
    const enqueueReport = jest.fn().mockRejectedValue(new Error('Redis is down'));
    mockedJournalSynthetic.mockRejectedValue(new Error('db unreachable'));

    await expect(
      reportOnSendIfObligated(
        {
          companyId: 'company-1',
          typeId: 'invoice',
          documentId: 'doc-1',
          queueDispatcher: { enqueueAction: jest.fn(), enqueueReport },
        },
        fixtureCatalog,
      ),
    ).resolves.toBeUndefined();
  });

  it('never journals anything when enqueueReport succeeds — only a genuine failure is worth a row', async () => {
    mockedResolveCountry.mockResolvedValue('HU');
    const enqueueReport = jest.fn().mockResolvedValue(true);

    await reportOnSendIfObligated(
      {
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction: jest.fn(), enqueueReport },
      },
      fixtureCatalog,
    );

    expect(mockedJournalSynthetic).not.toHaveBeenCalled();
  });

  it('never throws even when resolving the country itself rejects', async () => {
    mockedResolveCountry.mockRejectedValue(new Error('DB unreachable'));
    const enqueueReport = jest.fn();

    await expect(
      reportOnSendIfObligated(
        {
          companyId: 'company-1',
          typeId: 'invoice',
          documentId: 'doc-1',
          queueDispatcher: { enqueueAction: jest.fn(), enqueueReport },
        },
        fixtureCatalog,
      ),
    ).resolves.toBeUndefined();
    expect(enqueueReport).not.toHaveBeenCalled();
    // No `providerId` was ever resolved at this point — nothing meaningful to journal a lost
    // declaration against, unlike the enqueue-failure case above.
    expect(mockedJournalSynthetic).not.toHaveBeenCalled();
  });
});
