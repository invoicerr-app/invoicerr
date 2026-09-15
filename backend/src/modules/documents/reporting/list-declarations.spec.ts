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
        provenance: { kind: 'legal', sourceText: 'fixture', sourceCheckedAt: '2026-09-11' },
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

      await listDeclarations('company-A', 1, undefined, fixtureCatalog);

      const findManyArgs = mockedPrisma.documentAuthorityEvent.findMany.mock.calls[0][0];
      expect(findManyArgs.where.providerId).toEqual({ in: ['pt-at'] });
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
    const distinctCallArgs = mockedPrisma.documentAuthorityEvent.findMany.mock.calls[1][0];
    expect(distinctCallArgs.where).toEqual({ companyId: 'company-A', providerId: { in: ['pt-at'] } });
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
