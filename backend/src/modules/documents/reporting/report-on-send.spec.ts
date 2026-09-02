/**
 * `reportOnSendIfObligated`'s own WIRING — "does the trigger react correctly to a country's
 * obligation", never "is HU's own obligation real" (that is `registry.spec.ts`'s job). Same
 * "mock `country-policy/country-policy` wholesale" discipline `actions/invoice-channel-mandate.spec.ts`
 * already holds for the identical dependency.
 */
import * as countryPolicy from '../country-policy/country-policy';
import { ReportingObligationCatalog } from './registry';
import { reportOnSendIfObligated } from './report-on-send';

jest.mock('../country-policy/country-policy');

const mockedResolveCountry = countryPolicy.resolveCompanyCountryCode as jest.Mock;

const fixtureCatalog = new ReportingObligationCatalog([
  {
    countryCode: 'HU',
    facts: [
      {
        providerId: 'nav',
        appliesTo: 'invoice',
        provenance: { kind: 'legal', sourceText: 'fixture', sourceCheckedAt: '2026-09-02' },
      },
    ],
  },
]);

describe('reportOnSendIfObligated', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  // "jamais silencieux… mais jamais bloquant" for the ENQUEUE call itself: a failure here must never
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
  });
});
