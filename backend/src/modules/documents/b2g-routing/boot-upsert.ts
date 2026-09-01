/**
 * Makes the `B2gRoutingRule` table match `data/*.json` exactly — the pure, DB-touching half of the
 * mechanism `boot-upsert.service.ts` (an `OnModuleInit` provider) calls on EVERY backend boot. See
 * that service's own header, and `schema.prisma`'s own comment on `B2gRoutingRule`, for the full
 * "why boot, not `prisma/seed.ts`" reasoning — in short: `prisma/seed.ts` only runs after `migrate
 * dev`/`migrate reset`/`db seed`, which is exactly the reseed gap TODO_ISSUES.md already names for
 * `DocumentCountryActionRule` ("`resetAndSeed` ne re-sème pas la politique pays") — running this from
 * `OnModuleInit` instead means a NEW rule added to `data/*.json` reaches every already-migrated,
 * already-running instance (an e2e `cy.resetAndSeed()`, a self-hosted deployment) the next time it
 * simply RESTARTS, no separate reseed step to remember.
 *
 * Idempotent by construction: each row's identity is `countryCode` alone (the table's own
 * `@unique` — one rule per country, unlike `DocumentCountryActionRule`'s composite key). Re-running
 * upserts the same rows (no duplicates) and deletes nothing when the files are unchanged. Editing a
 * rule in its file and rebooting updates the row in place; removing a country's file makes its row
 * disappear on the next boot — the file is the ongoing source of truth, exactly like
 * `country-policy/seed.ts`'s own contract.
 *
 * Deliberately loosely typed (`PrismaB2gRoutingClient` below, not the generated Prisma Client type)
 * — same reasoning as `country-policy/seed.ts`'s own `PrismaCountryPolicyClient`: an internal
 * upserting utility, not a public API, trivially driven by a hand-rolled fake in tests
 * (`boot-upsert.spec.ts`) without depending on `prisma/generated/prisma` in the type signature.
 */
import { assertValidB2gRoutingFact, B2gRoutingRuleFact } from './schema';
import { B2gRoutingCatalog, defaultB2gRoutingCatalog } from './registry';

export interface B2gRoutingRuleRow {
  countryCode: string;
  transportId: string;
  formatSyntax: string;
  requiredClientIdentifiers: unknown;
  requiredDocumentFields: unknown;
  provenanceKind: string;
  sourceText: string | null;
  sourceCheckedAt: Date | null;
  resolutionNote: string | null;
  notes: string | null;
}

export interface PrismaB2gRoutingClient {
  b2gRoutingRule: {
    upsert: (args: {
      where: { countryCode: string };
      create: B2gRoutingRuleRow;
      update: Omit<B2gRoutingRuleRow, 'countryCode'>;
    }) => Promise<unknown>;
    findMany: (args: {
      select: { id: true; countryCode: true };
    }) => Promise<{ id: string; countryCode: string }[]>;
    deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<unknown>;
  };
}

export interface B2gRoutingBootUpsertSummary {
  /** Rows created or updated (upsert doesn't distinguish the two without an extra read — same
   *  convention as `CountryPolicySeedSummary.upserted`). */
  upserted: number;
  /** Rows removed because their country is no longer in `data/*.json` at all. */
  deleted: number;
}

function rowFor(fact: B2gRoutingRuleFact): B2gRoutingRuleRow {
  const provenance = fact.provenance;
  const legal = provenance.kind === 'legal' ? provenance : undefined;
  const unverified = provenance.kind === 'unverified' ? provenance : undefined;

  return {
    countryCode: fact.countryCode,
    transportId: fact.transportId,
    formatSyntax: fact.formatSyntax,
    requiredClientIdentifiers: fact.requiredClientIdentifiers ?? [],
    requiredDocumentFields: fact.requiredDocumentFields ?? [],
    provenanceKind: provenance.kind,
    sourceText: legal?.sourceText ?? null,
    sourceCheckedAt: legal ? new Date(legal.sourceCheckedAt) : null,
    resolutionNote: unverified?.resolutionNote ?? null,
    notes: fact.notes ?? null,
  };
}

export async function upsertB2gRoutingRules(
  prisma: PrismaB2gRoutingClient,
  catalog: B2gRoutingCatalog = defaultB2gRoutingCatalog,
): Promise<B2gRoutingBootUpsertSummary> {
  const countries = catalog.countries();

  // Second, independent gate — data/all.ts already validates every rule when a JSON file is loaded,
  // but this function takes a `B2gRoutingCatalog`, not a file path: a catalog built by hand (a test,
  // a future caller) must be refused here too, never trusted just because it constructed fine as an
  // object literal. Validated for EVERY country BEFORE writing a single row, same "never half-seed"
  // discipline `seedCountryPolicies` already holds.
  for (const countryCode of countries) {
    assertValidB2gRoutingFact(catalog.ruleFor(countryCode)!, `upsertB2gRoutingRules(${countryCode})`);
  }

  let upserted = 0;
  for (const countryCode of countries) {
    const row = rowFor(catalog.ruleFor(countryCode)!);
    await prisma.b2gRoutingRule.upsert({
      where: { countryCode },
      create: row,
      update: {
        transportId: row.transportId,
        formatSyntax: row.formatSyntax,
        requiredClientIdentifiers: row.requiredClientIdentifiers,
        requiredDocumentFields: row.requiredDocumentFields,
        provenanceKind: row.provenanceKind,
        sourceText: row.sourceText,
        sourceCheckedAt: row.sourceCheckedAt,
        resolutionNote: row.resolutionNote,
        notes: row.notes,
      },
    });
    upserted++;
  }

  const keep = new Set(countries);
  const existing = await prisma.b2gRoutingRule.findMany({ select: { id: true, countryCode: true } });
  const stale = existing.filter((row) => !keep.has(row.countryCode));
  let deleted = 0;
  if (stale.length > 0) {
    await prisma.b2gRoutingRule.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    deleted = stale.length;
  }

  return { upserted, deleted };
}
