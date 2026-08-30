/**
 * The REAL decision code — only the Prisma CLIENT is mocked (same discipline
 * country-policy/country-policy.spec.ts already established), not `resolveRequiredIdentifiers`
 * itself. This is where "a country with no rows declares nothing but SAYS so, and a country whose
 * file has something to say per party type says exactly that" is proven, against the real
 * branching logic — never by mocking the module this file's job is to test (this repository has
 * already hit false-green suites doing exactly that; see project MEMORY on it).
 */
import prisma from '@/prisma/prisma.service';

import { resolveRequiredIdentifiers } from './country-identifiers';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    countryIdentifierRequirement: { findMany: jest.fn() },
  },
}));

const findRequirements = prisma.countryIdentifierRequirement.findMany as jest.Mock;

describe('resolveRequiredIdentifiers', () => {
  beforeEach(() => jest.clearAllMocks());

  // DECISION, proven directly: a country with NO rows at all declares NO requirements — no
  // invented default — but SAYS so, exactly the "un pays sans fichier n'a aucune exigence déclarée,
  // et le dit" requirement this whole module exists to satisfy. If someone changes the
  // `rows.length === 0` branch to silently return an empty list with no reason (the exact mutation
  // this task asks to rehearse), this test goes red.
  it('a country with no rows at all declares NO requirements, and SAYS so by name — never a silently empty form', async () => {
    findRequirements.mockResolvedValue([]);

    const decision = await resolveRequiredIdentifiers('DE', 'COMPANY');

    expect(decision.requirements).toEqual([]);
    expect(decision.reason).toMatch(/"DE"/);
    expect(decision.reason).toMatch(/country-identifiers\/data\/de\.json/);
  });

  it('a country WITH a file but nothing declared for this party type is empty WITHOUT a reason — the ordinary case, not a misconfiguration', async () => {
    findRequirements.mockResolvedValue([
      {
        scheme: 'VAT',
        label: 'VAT number',
        appliesTo: 'COMPANY',
        required: false,
        pattern: null,
        helpText: null,
      },
    ]);

    const decision = await resolveRequiredIdentifiers('FR', 'INDIVIDUAL');

    expect(decision.requirements).toEqual([]);
    expect(decision.reason).toBeUndefined();
  });

  it('returns a matching row for the exact party type, mapping nulls to undefined', async () => {
    findRequirements.mockResolvedValue([
      {
        scheme: 'LEGAL_ID',
        label: 'SIRET',
        appliesTo: 'BOTH',
        required: true,
        pattern: '^\\d{14}$',
        helpText: '14 digits',
      },
      {
        scheme: 'VAT',
        label: 'VAT number',
        appliesTo: 'COMPANY',
        required: false,
        pattern: null,
        helpText: null,
      },
    ]);

    const decision = await resolveRequiredIdentifiers('FR', 'INDIVIDUAL');

    expect(decision.reason).toBeUndefined();
    expect(decision.requirements).toEqual([
      {
        scheme: 'LEGAL_ID',
        label: 'SIRET',
        appliesTo: 'BOTH',
        required: true,
        pattern: '^\\d{14}$',
        helpText: '14 digits',
      },
    ]);
  });

  it('a COMPANY-only scheme is included for a COMPANY party but not an INDIVIDUAL one', async () => {
    findRequirements.mockResolvedValue([
      {
        scheme: 'VAT',
        label: 'VAT number',
        appliesTo: 'COMPANY',
        required: false,
        pattern: null,
        helpText: null,
      },
    ]);

    const forCompany = await resolveRequiredIdentifiers('FR', 'COMPANY');
    expect(forCompany.requirements).toHaveLength(1);

    const forIndividual = await resolveRequiredIdentifiers('FR', 'INDIVIDUAL');
    expect(forIndividual.requirements).toHaveLength(0);
  });

  it('normalizes the country code (trims, upper-cases) before querying', async () => {
    findRequirements.mockResolvedValue([]);

    await resolveRequiredIdentifiers(' fr ', 'COMPANY');

    expect(findRequirements).toHaveBeenCalledWith({ where: { countryCode: 'FR' } });
  });

  it('an empty/missing country code is refused with its own distinct reason, without ever querying the table', async () => {
    const decision = await resolveRequiredIdentifiers(undefined, 'COMPANY');

    expect(decision.requirements).toEqual([]);
    expect(decision.reason).toMatch(/No country code/);
    expect(findRequirements).not.toHaveBeenCalled();
  });
});
