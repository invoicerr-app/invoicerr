/**
 * The REAL decision code — only the Prisma CLIENT is mocked, same discipline
 * `country-policy/country-policy.spec.ts` already established for the identical reason (this
 * module's own MEMORY note on mocking the exact piece under test — see that file's own header).
 * `actions/invoice-b2g-routing.spec.ts` is the SEPARATE file that proves `invoice-actions.ts` reacts
 * correctly to whatever THIS module decides (mocking this module wholesale, the way
 * `invoice-channel-mandate.spec.ts` already mocks `channel-policy/mandate.ts`).
 */
import prisma from '@/prisma/prisma.service';

import { resolveB2gRoutingRule, resolveClientB2gRouting } from './b2g-routing';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    client: { findFirst: jest.fn() },
    b2gRoutingRule: { findUnique: jest.fn() },
  },
}));

const findClient = prisma.client.findFirst as jest.Mock;
const findRule = prisma.b2gRoutingRule.findUnique as jest.Mock;

const RULE_ROW = {
  countryCode: 'IT',
  transportId: 'sdi',
  formatSyntax: 'fatturapa',
  requiredClientIdentifiers: [
    { scheme: 'IT_PA_CODE', label: 'Codice Univoco Ufficio (IPA)', why: 'because the law says so' },
  ],
  requiredDocumentFields: [],
  provenanceKind: 'legal',
  sourceText: 'Specifiche tecniche del formato della fattura del Sistema di Interscambio, v1.3.2.',
  sourceCheckedAt: new Date('2026-09-01T00:00:00.000Z'),
  resolutionNote: null,
};

describe('resolveB2gRoutingRule', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns undefined for a country with no rule at all', async () => {
    findRule.mockResolvedValue(null);
    expect(await resolveB2gRoutingRule('ZZ')).toBeUndefined();
  });

  it('returns undefined for an empty/undefined country code — never a guessed rule', async () => {
    expect(await resolveB2gRoutingRule(undefined)).toBeUndefined();
    expect(await resolveB2gRoutingRule('')).toBeUndefined();
    expect(findRule).not.toHaveBeenCalled();
  });

  it('returns the view, uppercased lookup, with a provenance description naming the source', async () => {
    findRule.mockResolvedValue(RULE_ROW);
    const rule = await resolveB2gRoutingRule('it');
    expect(findRule).toHaveBeenCalledWith({ where: { countryCode: 'IT' } });
    expect(rule).toMatchObject({ countryCode: 'IT', transportId: 'sdi', formatSyntax: 'fatturapa' });
    expect(rule!.provenanceDescription).toContain('Specifiche tecniche');
    expect(rule!.provenanceDescription).toContain('2026-09-01');
  });
});

describe('resolveClientB2gRouting', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not apply when no clientId is given', async () => {
    const decision = await resolveClientB2gRouting('company-1', undefined);
    expect(decision).toEqual({ applies: false, missingIdentifierSchemes: [] });
    expect(findClient).not.toHaveBeenCalled();
  });

  it('does not apply for a client that cannot be found', async () => {
    findClient.mockResolvedValue(null);
    const decision = await resolveClientB2gRouting('company-1', 'client-1');
    expect(decision.applies).toBe(false);
  });

  it('does not apply for a BUSINESS client — the default, and every pre-existing client', async () => {
    findClient.mockResolvedValue({
      id: 'client-1',
      kind: 'BUSINESS',
      country: 'Italy',
      countryCode: 'IT',
      partyIdentifiers: [],
    });
    const decision = await resolveClientB2gRouting('company-1', 'client-1');
    expect(decision.applies).toBe(false);
    expect(findRule).not.toHaveBeenCalled();
  });

  it("applies but carries no countryCode when the GOVERNMENT client's own country cannot be resolved", async () => {
    findClient.mockResolvedValue({
      id: 'client-1',
      kind: 'GOVERNMENT',
      country: 'Nowhereland',
      countryCode: null,
      partyIdentifiers: [],
    });
    const decision = await resolveClientB2gRouting('company-1', 'client-1');
    expect(decision).toEqual({
      applies: true,
      clientCountryRaw: 'Nowhereland',
      missingIdentifierSchemes: [],
    });
    expect(findRule).not.toHaveBeenCalled();
  });

  it('applies, resolves the country, but carries no rule when the country has none declared — HONEST, never B2B silently', async () => {
    findClient.mockResolvedValue({
      id: 'client-1',
      kind: 'GOVERNMENT',
      country: 'Nowhereland',
      countryCode: 'ZZ',
      partyIdentifiers: [],
    });
    findRule.mockResolvedValue(null);
    const decision = await resolveClientB2gRouting('company-1', 'client-1');
    expect(decision).toEqual({ applies: true, countryCode: 'ZZ', missingIdentifierSchemes: [] });
  });

  it('a rule exists and every required identifier is on file — no missing schemes', async () => {
    findClient.mockResolvedValue({
      id: 'client-1',
      kind: 'GOVERNMENT',
      country: 'Italy',
      countryCode: 'IT',
      partyIdentifiers: [{ scheme: 'IT_PA_CODE', value: 'ABCDEF' }],
    });
    findRule.mockResolvedValue(RULE_ROW);
    const decision = await resolveClientB2gRouting('company-1', 'client-1');
    expect(decision.applies).toBe(true);
    expect(decision.rule?.transportId).toBe('sdi');
    expect(decision.missingIdentifierSchemes).toEqual([]);
  });

  it('a rule exists but the required identifier is MISSING (absent) — named in missingIdentifierSchemes', async () => {
    findClient.mockResolvedValue({
      id: 'client-1',
      kind: 'GOVERNMENT',
      country: 'Italy',
      countryCode: 'IT',
      partyIdentifiers: [],
    });
    findRule.mockResolvedValue(RULE_ROW);
    const decision = await resolveClientB2gRouting('company-1', 'client-1');
    expect(decision.missingIdentifierSchemes).toEqual(['IT_PA_CODE']);
  });

  it('a rule exists but the required identifier is BLANK (present but empty) — treated the same as missing', async () => {
    findClient.mockResolvedValue({
      id: 'client-1',
      kind: 'GOVERNMENT',
      country: 'Italy',
      countryCode: 'IT',
      partyIdentifiers: [{ scheme: 'IT_PA_CODE', value: '   ' }],
    });
    findRule.mockResolvedValue(RULE_ROW);
    const decision = await resolveClientB2gRouting('company-1', 'client-1');
    expect(decision.missingIdentifierSchemes).toEqual(['IT_PA_CODE']);
  });
});
