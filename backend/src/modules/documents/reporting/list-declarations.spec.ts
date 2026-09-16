/**
 * `listDeclarations`'s own contract — company scoping, telling a declaration apart from an ordinary
 * conformity poll event by `providerId`, surfacing a failed/blocked declaration's own reason, and the
 * "no obligation for this country" signal. Mocks Prisma the same way
 * `conformity/authority-events.persistence.spec.ts` already does; mocks `country-policy/country-policy`
 * the same way `report-on-send.spec.ts` already does for the identical dependency.
 */
import * as countryPolicy from '../country-policy/country-policy';
import { CountryReportingObligationFile } from './schema';
import { ReportingObligationCatalog } from './registry';
import prisma from '@/prisma/prisma.service';
import { declarationProviderIds, listDeclarations } from './list-declarations';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    documentAuthorityEvent: { findMany: jest.fn(), count: jest.fn() },
  },
}));

jest.mock('../country-policy/country-policy');

const mockedPrisma = prisma as unknown as {
  documentAuthorityEvent: { findMany: jest.Mock; count: jest.Mock };
};

const mockedResolveCountry = countryPolicy.resolveCompanyCountryCode as jest.Mock;

const fixtureFiles: CountryReportingObligationFile[] = [
  {
    countryCode: 'PT',
    facts: [
      {
        providerId: 'pt-at',
        appliesTo: 'invoice',
        dischargedBy: 'provider',
        provenance: { kind: 'legal', sourceText: 'fixture', sourceCheckedAt: '2026-09-11' },
      },
    ],
  },
];

// France's real shape (`reporting/data/fr.json`): a "transport"-discharged fact whose own
// `providerId` ("pdp") is ALSO a `transports/transport-registry.ts` id, already used by PDP's own
// conformity-poll events (`conformity/pollers/`) under that SAME string. `declarationProviderIds`'s
// own filter (`dischargedBy === 'provider'`) is what keeps that collision from leaking a PDP
// delivery-conformity event into this "declarations" list — the fixture below proves it directly.
const transportShapedFiles: CountryReportingObligationFile[] = [
  {
    countryCode: 'FR',
    facts: [
      {
        providerId: 'pdp',
        appliesTo: 'invoice',
        dischargedBy: 'transport',
        provenance: { kind: 'legal', sourceText: 'fixture: CGI art. 289 E', sourceCheckedAt: '2026-09-16' },
      },
    ],
  },
];

const fixtureCatalog = new ReportingObligationCatalog(fixtureFiles);

describe('declarationProviderIds', () => {
  it('collects every providerId across every country file, deduped', () => {
    expect(declarationProviderIds(fixtureFiles)).toEqual(['pt-at']);
  });

  it('returns an empty list for zero country files — never a hand-maintained fallback', () => {
    expect(declarationProviderIds([])).toEqual([]);
  });

  // THE MUTATION TARGET: a version of this function that collected EVERY fact's `providerId`
  // regardless of `dischargedBy` would include "pdp" here — conflating a transport's own
  // conformity-poll id with a genuine tax-authority declaration (see this file's own header).
  it('excludes a "transport"-discharged fact\'s own providerId — it is not a declaration provider', () => {
    expect(declarationProviderIds(transportShapedFiles)).toEqual([]);
  });

  it('a mix of "provider" and "transport" facts keeps only the provider-discharged id', () => {
    expect(declarationProviderIds([...fixtureFiles, ...transportShapedFiles])).toEqual(['pt-at']);
  });
});

describe('listDeclarations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('scopes the query to the caller’s OWN companyId — never another tenant’s', async () => {
    mockedPrisma.documentAuthorityEvent.findMany.mockResolvedValue([]);
    mockedPrisma.documentAuthorityEvent.count.mockResolvedValue(0);
    mockedResolveCountry.mockResolvedValue('PT');

    await listDeclarations('company-A', 1, undefined, fixtureCatalog);

    const findManyArgs = mockedPrisma.documentAuthorityEvent.findMany.mock.calls[0][0];
    expect(findManyArgs.where.companyId).toBe('company-A');
    const countArgs = mockedPrisma.documentAuthorityEvent.count.mock.calls[0][0];
    expect(countArgs.where.companyId).toBe('company-A');
  });

  it(
    'filters providerId to ONLY the ones a reporting/data/*.json fact names — a "pdp"/"ksef" ' +
      'conformity-poll event never leaks into this list',
    async () => {
      mockedPrisma.documentAuthorityEvent.findMany.mockResolvedValue([]);
      mockedPrisma.documentAuthorityEvent.count.mockResolvedValue(0);
      mockedResolveCountry.mockResolvedValue('PT');

      // `listDeclarations` computes its OWN `providerIds` from the real, shipped catalog
      // (`declarationProviderIds()`, no `files` argument — see that function's own header), never
      // from the `catalog` injected below (that one only drives `hasObligation`) — so this reflects
      // the REAL `reporting/data/*.json` set: PT's "pt-at" AND France's own "fr-ereporting"
      // (`dischargedBy: 'provider'`), but pointedly NOT France's "pdp" fact — that one is
      // `dischargedBy: 'transport'`, the exact "pdp"/"ksef" conflation this test's own title names.
      await listDeclarations('company-A', 1, undefined, fixtureCatalog);

      const findManyArgs = mockedPrisma.documentAuthorityEvent.findMany.mock.calls[0][0];
      expect(findManyArgs.where.providerId).toEqual({ in: ['fr-ereporting', 'pt-at'] });
      expect(findManyArgs.where.providerId.in).not.toContain('pdp');
    },
  );

  it(
    'surfaces a FAILED declaration’s own reason — an invisible failure is exactly the muted-failure ' +
      'class this screen exists to close',
    async () => {
      mockedPrisma.documentAuthorityEvent.findMany.mockResolvedValue([
        {
          id: 'evt-1',
          documentId: 'doc-1',
          providerId: 'pt-at',
          statusCode: 'report:failed',
          statusText: null,
          reason: 'AT webservice unreachable: ETIMEDOUT',
          observedAt: new Date('2026-09-14T10:00:00Z'),
          document: { typeId: 'invoice', displayNumber: 'INV-2026-0042' },
        },
      ]);
      mockedPrisma.documentAuthorityEvent.count.mockResolvedValue(1);
      mockedResolveCountry.mockResolvedValue('PT');

      const result = await listDeclarations('company-A', 1, undefined, fixtureCatalog);

      expect(result.declarations).toEqual([
        {
          id: 'evt-1',
          documentId: 'doc-1',
          typeId: 'invoice',
          displayNumber: 'INV-2026-0042',
          providerId: 'pt-at',
          countryCode: 'PT',
          statusCode: 'report:failed',
          statusText: null,
          reason: 'AT webservice unreachable: ETIMEDOUT',
          observedAt: new Date('2026-09-14T10:00:00Z'),
        },
      ]);
    },
  );

  it(
    'surfaces a BLOCKED declaration’s own reason too — the exact 64-declarations.cy.ts scenario ' +
      '(a missing "pt-at" credential, journaled by `journalSyntheticEvent` via `reporting-runner.ts`), ' +
      'proven here at the unit level rather than only inferred from the e2e run',
    async () => {
      mockedPrisma.documentAuthorityEvent.findMany.mockResolvedValue([
        {
          id: 'evt-3',
          documentId: 'doc-3',
          providerId: 'pt-at',
          statusCode: 'report:blocked',
          statusText: null,
          reason: 'The "pt-at" channel is not connected (or its credentials are incomplete).',
          observedAt: new Date('2026-09-14T12:00:00Z'),
          document: { typeId: 'invoice', displayNumber: 'INV-2026-0044' },
        },
      ]);
      mockedPrisma.documentAuthorityEvent.count.mockResolvedValue(1);
      mockedResolveCountry.mockResolvedValue('PT');

      const result = await listDeclarations('company-A', 1, undefined, fixtureCatalog);

      expect(result.declarations).toEqual([
        {
          id: 'evt-3',
          documentId: 'doc-3',
          typeId: 'invoice',
          displayNumber: 'INV-2026-0044',
          providerId: 'pt-at',
          countryCode: 'PT',
          statusCode: 'report:blocked',
          statusText: null,
          reason: 'The "pt-at" channel is not connected (or its credentials are incomplete).',
          observedAt: new Date('2026-09-14T12:00:00Z'),
        },
      ]);
    },
  );

  it('a genuine success (ACCEPTED) carries no reason at all', async () => {
    mockedPrisma.documentAuthorityEvent.findMany.mockResolvedValue([
      {
        id: 'evt-2',
        documentId: 'doc-2',
        providerId: 'pt-at',
        statusCode: 'ACCEPTED',
        statusText: null,
        reason: null,
        observedAt: new Date('2026-09-14T11:00:00Z'),
        document: { typeId: 'invoice', displayNumber: 'INV-2026-0043' },
      },
    ]);
    mockedPrisma.documentAuthorityEvent.count.mockResolvedValue(1);
    mockedResolveCountry.mockResolvedValue('PT');

    const result = await listDeclarations('company-A', 1, undefined, fixtureCatalog);
    expect(result.declarations[0].reason).toBeNull();
    expect(result.declarations[0].statusCode).toBe('ACCEPTED');
  });

  it('applies an exact statusCode filter when `status` is given', async () => {
    mockedPrisma.documentAuthorityEvent.findMany.mockResolvedValue([]);
    mockedPrisma.documentAuthorityEvent.count.mockResolvedValue(0);
    mockedResolveCountry.mockResolvedValue('PT');

    await listDeclarations('company-A', 1, 'report:blocked', fixtureCatalog);

    const findManyArgs = mockedPrisma.documentAuthorityEvent.findMany.mock.calls[0][0];
    expect(findManyArgs.where.statusCode).toBe('report:blocked');
  });

  it('computes statusCodes from the FULL set, not narrowed by the status filter itself', async () => {
    mockedPrisma.documentAuthorityEvent.findMany.mockResolvedValue([]);
    mockedPrisma.documentAuthorityEvent.count.mockResolvedValue(0);
    mockedResolveCountry.mockResolvedValue('PT');

    await listDeclarations('company-A', 1, 'report:blocked', fixtureCatalog);

    // The SECOND findMany call (the distinct statusCodes query) must never carry the `status` filter.
    // Same real-catalog `providerIds` set as the test above — see that test's own comment.
    const distinctCallArgs = mockedPrisma.documentAuthorityEvent.findMany.mock.calls[1][0];
    expect(distinctCallArgs.where).toEqual({
      companyId: 'company-A',
      providerId: { in: ['fr-ereporting', 'pt-at'] },
    });
    expect(distinctCallArgs.distinct).toEqual(['statusCode']);
  });

  it('paginates with a 1-indexed page and a fixed page size, mirroring clients.service.ts', async () => {
    mockedPrisma.documentAuthorityEvent.findMany.mockResolvedValue([]);
    mockedPrisma.documentAuthorityEvent.count.mockResolvedValue(0);
    mockedResolveCountry.mockResolvedValue('PT');

    await listDeclarations('company-A', 2, undefined, fixtureCatalog);

    const findManyArgs = mockedPrisma.documentAuthorityEvent.findMany.mock.calls[0][0];
    expect(findManyArgs.skip).toBe(10);
    expect(findManyArgs.take).toBe(10);
  });

  it('a non-finite/zero/negative page falls back to page 1 — never a negative skip', async () => {
    mockedPrisma.documentAuthorityEvent.findMany.mockResolvedValue([]);
    mockedPrisma.documentAuthorityEvent.count.mockResolvedValue(0);
    mockedResolveCountry.mockResolvedValue('PT');

    await listDeclarations('company-A', 0, undefined, fixtureCatalog);

    const findManyArgs = mockedPrisma.documentAuthorityEvent.findMany.mock.calls[0][0];
    expect(findManyArgs.skip).toBe(0);
  });

  it('hasObligation is true for a country the catalog declares a fact for', async () => {
    mockedPrisma.documentAuthorityEvent.findMany.mockResolvedValue([]);
    mockedPrisma.documentAuthorityEvent.count.mockResolvedValue(0);
    mockedResolveCountry.mockResolvedValue('PT');

    const result = await listDeclarations('company-A', 1, undefined, fixtureCatalog);
    expect(result.hasObligation).toBe(true);
  });

  it('hasObligation is false — plainly, never a silent empty list — for a country with NO fact at all', async () => {
    mockedPrisma.documentAuthorityEvent.findMany.mockResolvedValue([]);
    mockedPrisma.documentAuthorityEvent.count.mockResolvedValue(0);
    mockedResolveCountry.mockResolvedValue('FR');

    const result = await listDeclarations('company-A', 1, undefined, fixtureCatalog);
    expect(result.hasObligation).toBe(false);
  });

  it('hasObligation is undefined when the company’s own country cannot even be resolved — never a guess', async () => {
    mockedPrisma.documentAuthorityEvent.findMany.mockResolvedValue([]);
    mockedPrisma.documentAuthorityEvent.count.mockResolvedValue(0);
    mockedResolveCountry.mockResolvedValue(undefined);

    const result = await listDeclarations('company-A', 1, undefined, fixtureCatalog);
    expect(result.hasObligation).toBeUndefined();
  });
});
