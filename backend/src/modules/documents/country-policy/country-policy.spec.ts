/**
 * The REAL decision code — only the Prisma CLIENT is mocked (same discipline
 * transports/company-transport.spec.ts already established for `getCompanyInvoiceTransportId`), not
 * `evaluateCountryPolicy` itself. This is deliberate: this repository has already hit two false-green
 * suites that mocked the exact piece they claimed to verify (see this module's own git history and
 * the project MEMORY on it) — every other spec touching country policy in this codebase (
 * documents.service.*.spec.ts) mocks THIS module and is honest about only proving the CALLER's
 * wiring. This file is where "a country with no policy blocks everything, and says so by name" is
 * actually proven, against the real branching logic.
 */
import prisma from '@/prisma/prisma.service';

import {
  evaluateCountryPolicy,
  resolveAvailableDocumentTypes,
  resolveCompanyCountryCode,
} from './country-policy';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    documentCountryActionRule: { findMany: jest.fn() },
  },
}));

const findCompany = prisma.company.findUnique as jest.Mock;
const findRules = prisma.documentCountryActionRule.findMany as jest.Mock;

describe('evaluateCountryPolicy', () => {
  beforeEach(() => jest.clearAllMocks());

  // DECISION 1, proven directly: a country with NO rows in the policy table blocks EVERY action —
  // no permissive fallback. If someone changes the `rules.length === 0` branch to return
  // `{ allowed: true }` (the exact mutation this task asks to rehearse), this test goes red.
  // `findRules` is mocked straight to `[]` here — this proves the CODE PATH for "zero rows", not a
  // claim about which real country has none; Germany was this fixture's placeholder until root TODO
  // P1 gave it a real, sourced policy file, so it moved to Belgium (still genuinely uncovered) rather
  // than keep a now-misleading "Germany has no rows" framing.
  it('blocks EVERY action for a country with no policy rows at all, and NAMES the country', async () => {
    findCompany.mockResolvedValue({ country: 'Belgium', countryCode: 'BE' });
    findRules.mockResolvedValue([]);

    const decision = await evaluateCountryPolicy('company-1', 'invoice', 'save-draft');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/"BE"/);
    // Says what would unblock it — not just "no", the same discipline the transport 501 keeps.
    expect(decision.reason).toMatch(/country-policy\/data\/be\.json/);
  });

  // Root TODO item 18 ("réception de factures") — the SAME mechanism, proven again against the new
  // type/action pair, for the exact case the task asks to prove directly: "approve refusé pour un
  // pays sans règle → 403 nommé" (the 403 itself is documents.service.received-invoice.spec.ts's own
  // wiring proof; THIS is the real, unmocked decision the service call above is proven to relay).
  it('blocks "received-invoice"/"approve" for a country with no policy rows at all, and NAMES the country', async () => {
    findCompany.mockResolvedValue({ country: 'Belgium', countryCode: 'BE' });
    findRules.mockResolvedValue([]);

    const decision = await evaluateCountryPolicy('company-1', 'received-invoice', 'approve');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/"BE"/);
    expect(decision.reason).toMatch(/country-policy\/data\/be\.json/);
  });

  it('blocks an action never declared for a country that DOES have OTHER rules — an allow-list, not a deny-list', async () => {
    findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });
    findRules.mockResolvedValue([
      { typeId: 'invoice', actionId: 'send', allowed: true, provenanceKind: 'legal', sourceText: 'x' },
    ]);

    const decision = await evaluateCountryPolicy('company-1', 'quote', 'duplicate');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/"duplicate"/);
    expect(decision.reason).toMatch(/quote/);
    expect(decision.reason).toMatch(/"FR"/);
  });

  it('allows an action a matching rule marks allowed: true', async () => {
    findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });
    findRules.mockResolvedValue([
      { typeId: 'invoice', actionId: 'send', allowed: true, provenanceKind: 'legal', sourceText: 'x' },
    ]);

    const decision = await evaluateCountryPolicy('company-1', 'invoice', 'send');

    expect(decision).toEqual({ allowed: true });
  });

  it('refuses an action a matching rule explicitly marks allowed: false, naming the action and the country', async () => {
    findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });
    findRules.mockResolvedValue([
      {
        typeId: 'invoice',
        actionId: 'send',
        allowed: false,
        provenanceKind: 'legal',
        sourceText: 'Some exact legal text.',
      },
    ]);

    const decision = await evaluateCountryPolicy('company-1', 'invoice', 'send');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/"send"/);
    expect(decision.reason).toMatch(/"FR"/);
    expect(decision.reason).toMatch(/Some exact legal text\./);
  });

  it('falls back to guessing the ISO code from the free-text country when countryCode is not set', async () => {
    findCompany.mockResolvedValue({ country: 'France', countryCode: null });
    findRules.mockResolvedValue([
      {
        typeId: 'invoice',
        actionId: 'send',
        allowed: true,
        provenanceKind: 'unverified',
        resolutionNote: 'x',
      },
    ]);

    const decision = await evaluateCountryPolicy('company-1', 'invoice', 'send');

    expect(decision).toEqual({ allowed: true });
    expect(findRules).toHaveBeenCalledWith({ where: { countryCode: 'FR' } });
  });

  it('blocks with a distinct message when the country cannot even be resolved to an ISO code', async () => {
    findCompany.mockResolvedValue({ country: 'Atlantis', countryCode: null });

    const decision = await evaluateCountryPolicy('company-1', 'invoice', 'save-draft');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/Atlantis/);
    expect(decision.reason).toMatch(/does not resolve to a recognized ISO/);
    // Never even queries the rules table for an unresolvable country — nothing to look up yet.
    expect(findRules).not.toHaveBeenCalled();
  });

  it('scopes the rules lookup to the resolved country code, not the raw company id', async () => {
    findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });
    findRules.mockResolvedValue([]);

    await evaluateCountryPolicy('company-42', 'invoice', 'save-draft');

    expect(findCompany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'company-42' } }));
    expect(findRules).toHaveBeenCalledWith({ where: { countryCode: 'FR' } });
  });

  // Country-policy per-status narrowing (schema.ts's DocumentActionRuleFact.statuses) — the same
  // decision code as every other test in this describe block, only the row's own `statuses` column
  // varies. THE mutation target: making this branch permissive (returning `{allowed:true}` unconditionally
  // regardless of `rule.statuses`) is exactly what the task's second required mutation exercises —
  // see documents.service.lifecycle.spec.ts's own per-status tests for the composed, request-level proof.
  describe('per-status narrowing (rule.statuses)', () => {
    it('an allowed rule with a non-empty `statuses` reports it as `restrictedToStatuses`', async () => {
      findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      findRules.mockResolvedValue([
        {
          typeId: 'invoice',
          actionId: 'save-draft',
          allowed: true,
          provenanceKind: 'unverified',
          resolutionNote: 'x',
          statuses: ['draft'],
        },
      ]);

      const decision = await evaluateCountryPolicy('company-1', 'invoice', 'save-draft');

      expect(decision).toEqual({ allowed: true, restrictedToStatuses: ['draft'] });
    });

    it('an allowed rule with an EMPTY `statuses` array reports no restriction at all', async () => {
      findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      findRules.mockResolvedValue([
        {
          typeId: 'invoice',
          actionId: 'save-draft',
          allowed: true,
          provenanceKind: 'unverified',
          resolutionNote: 'x',
          statuses: [],
        },
      ]);

      const decision = await evaluateCountryPolicy('company-1', 'invoice', 'save-draft');

      expect(decision).toEqual({ allowed: true });
    });

    it('an allowed rule with no `statuses` column at all (the ordinary case) reports no restriction', async () => {
      findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      findRules.mockResolvedValue([
        {
          typeId: 'invoice',
          actionId: 'save-draft',
          allowed: true,
          provenanceKind: 'legal',
          sourceText: 'x',
        },
      ]);

      const decision = await evaluateCountryPolicy('company-1', 'invoice', 'save-draft');

      expect(decision).toEqual({ allowed: true });
    });

    it('`statuses` on a FORBIDDEN rule is irrelevant — the action is already blocked at every status', async () => {
      findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });
      findRules.mockResolvedValue([
        {
          typeId: 'invoice',
          actionId: 'save-draft',
          allowed: false,
          provenanceKind: 'legal',
          sourceText: 'Some exact legal text.',
          statuses: ['draft'],
        },
      ]);

      const decision = await evaluateCountryPolicy('company-1', 'invoice', 'save-draft');

      expect(decision.allowed).toBe(false);
      expect(decision).not.toHaveProperty('restrictedToStatuses');
    });
  });
});

/**
 * `resolveAvailableDocumentTypes` reads the REAL, shipped country-policy catalog (fr.json/us.json —
 * `defaultCountryPolicyCatalog`, see registry.ts), not a hand-built fixture: this is exactly the
 * piece under test (schema.ts's `documentTypes`), so faking it here would be the same mistake this
 * file's own header warns against — a suite that mocks the exact thing it claims to verify. Only the
 * Prisma company lookup is mocked, same discipline as evaluateCountryPolicy above.
 */
describe('resolveAvailableDocumentTypes', () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the real FR file's declared document types", async () => {
    findCompany.mockResolvedValue({ country: 'France', countryCode: 'FR' });

    const decision = await resolveAvailableDocumentTypes('company-1');

    expect(decision.reason).toBeUndefined();
    expect(decision.typeIds.slice().sort()).toEqual(
      ['quote', 'invoice', 'credit-note', 'expense', 'received-invoice'].slice().sort(),
    );
  });

  // A country with NO policy file at all (e.g. Belgium — see the COUNTRY_FILES list in data/all.ts,
  // which as of root TODO P1 covers FR/US/HU/DE/IT/PL/ES/MX only) must say so BY NAME, never render a
  // silently empty group — this is the "un pays sans règles n'a aucun type, et son groupe Documents
  // doit le DIRE" requirement, proven against the real catalog rather than a mock of it. Germany used
  // to be this test's placeholder "uncovered" country; root TODO P1 gave it a real, sourced policy
  // file, so this fixture moved to Belgium (still genuinely absent from COUNTRY_FILES) rather than
  // weakening what this test proves.
  it('a country with no policy file at all has NO types, and says so by name — never a silent empty list', async () => {
    findCompany.mockResolvedValue({ country: 'Belgium', countryCode: 'BE' });

    const decision = await resolveAvailableDocumentTypes('company-1');

    expect(decision.typeIds).toEqual([]);
    expect(decision.reason).toMatch(/"BE"/);
    expect(decision.reason).toMatch(/documentTypes/);
  });

  it('blocks with a distinct message when the country cannot even be resolved to an ISO code', async () => {
    findCompany.mockResolvedValue({ country: 'Atlantis', countryCode: null });

    const decision = await resolveAvailableDocumentTypes('company-1');

    expect(decision.typeIds).toEqual([]);
    expect(decision.reason).toMatch(/Atlantis/);
    expect(decision.reason).toMatch(/does not resolve to a recognized ISO/);
  });

  it('falls back to guessing the ISO code from the free-text country when countryCode is not set', async () => {
    findCompany.mockResolvedValue({ country: 'France', countryCode: null });

    const decision = await resolveAvailableDocumentTypes('company-1');

    expect(decision.reason).toBeUndefined();
    expect(decision.typeIds.length).toBeGreaterThan(0);
  });
});

describe('resolveCompanyCountryCode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('prefers the explicit countryCode override over guessing from the free-text name', async () => {
    findCompany.mockResolvedValue({ country: 'Deutschland', countryCode: 'DE' });
    expect(await resolveCompanyCountryCode('company-1')).toBe('DE');
  });

  it('falls back to guessing the ISO code from the free-text country when countryCode is not set', async () => {
    findCompany.mockResolvedValue({ country: 'France', countryCode: null });
    expect(await resolveCompanyCountryCode('company-1')).toBe('FR');
  });

  it('returns undefined — never throws, never an empty string — when nothing resolves', async () => {
    findCompany.mockResolvedValue({ country: 'Atlantis', countryCode: null });
    expect(await resolveCompanyCountryCode('company-1')).toBeUndefined();
  });

  it('returns undefined for a company that does not exist', async () => {
    findCompany.mockResolvedValue(null);
    expect(await resolveCompanyCountryCode('company-1')).toBeUndefined();
  });
});
