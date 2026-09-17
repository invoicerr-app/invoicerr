/**
 * Makes the `CountryIdentifierRequirement` table match the identifier-requirements files exactly —
 * see schema.prisma's own comment on that model, and this directory's schema.ts for what a "fact"
 * is and why it can never exist without a provenance. Same idempotent-by-(countryCode, scheme)
 * upsert/delete-stale shape as country-policy/seed.ts — see that file's own header, unchanged here:
 * adding a scheme to a country's file is enough to make it appear on the next reseed; removing one
 * makes its row disappear.
 *
 * Deliberately loosely typed (`PrismaCountryIdentifierRequirementsClient` below, not the generated
 * Prisma Client type) — same reasoning as country-policy/seed.ts's own
 * `PrismaCountryPolicyClient`: an internal seeding utility, trivial to drive with a hand-rolled fake
 * in tests (see seed.spec.ts) without depending on `prisma/generated/prisma` in the signature.
 */
import {
  assertPatternIsExplainable,
  assertValidProvenance,
  IdentifierSchemeFact,
  LegalProvenance,
  UnverifiedProvenance,
} from './schema';
import {
  CountryIdentifierRequirementsCatalog,
  defaultCountryIdentifierRequirementsCatalog,
} from './registry';

export interface CountryIdentifierRequirementRow {
  countryCode: string;
  scheme: string;
  appliesTo: string;
  label: string;
  required: boolean;
  pattern: string | null;
  helpText: string | null;
  provenanceKind: string;
  sourceText: string | null;
  sourceCheckedAt: Date | null;
  resolutionNote: string | null;
  notes: string | null;
}

// The full row shape `findMany` selects, used for BOTH the per-country stale-scheme check below AND
// (with no `where` at all) the whole-country purge and drift.ts's own comparison — same reasoning as
// country-policy/seed.ts's own `COUNTRY_POLICY_ROW_SELECT`. `where` is optional for exactly that
// second, table-wide use.
export const COUNTRY_IDENTIFIER_REQUIREMENT_ROW_SELECT = {
  id: true,
  countryCode: true,
  scheme: true,
  appliesTo: true,
  label: true,
  required: true,
  pattern: true,
  helpText: true,
  provenanceKind: true,
  sourceText: true,
  sourceCheckedAt: true,
  resolutionNote: true,
  notes: true,
} as const;

export interface PrismaCountryIdentifierRequirementsClient {
  countryIdentifierRequirement: {
    upsert: (args: {
      where: { countryCode_scheme: { countryCode: string; scheme: string } };
      create: CountryIdentifierRequirementRow;
      update: Omit<CountryIdentifierRequirementRow, 'countryCode' | 'scheme'>;
    }) => Promise<unknown>;
    findMany: (args: {
      where?: { countryCode: string };
      select: typeof COUNTRY_IDENTIFIER_REQUIREMENT_ROW_SELECT;
    }) => Promise<(CountryIdentifierRequirementRow & { id: string })[]>;
    deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<unknown>;
  };
  $transaction: <T>(fn: (tx: PrismaCountryIdentifierRequirementsClient) => Promise<T>) => Promise<T>;
}

export interface CountryIdentifierRequirementsSeedSummary {
  /** Rows created or updated (upsert doesn't distinguish the two without an extra read, and the
   *  distinction isn't useful here — both mean "this row now matches the file"). */
  upserted: number;
  /** Rows removed because their scheme is no longer in the file for that country. */
  deleted: number;
}

// Exported for drift.ts: computing "what the DB SHOULD look like for this country" is the exact
// same transform whether it feeds an upsert or a drift comparison — one function, never two
// versions that could quietly diverge.
export function rowFor(countryCode: string, fact: IdentifierSchemeFact): CountryIdentifierRequirementRow {
  const legal = fact.provenance.kind === 'legal' ? (fact.provenance as LegalProvenance) : undefined;
  const unverified =
    fact.provenance.kind === 'unverified' ? (fact.provenance as UnverifiedProvenance) : undefined;

  return {
    countryCode,
    scheme: fact.scheme,
    appliesTo: fact.appliesTo,
    label: fact.label,
    required: fact.required,
    pattern: fact.pattern ?? null,
    helpText: fact.helpText ?? null,
    provenanceKind: fact.provenance.kind,
    sourceText: legal?.sourceText ?? null,
    sourceCheckedAt: legal ? new Date(legal.sourceCheckedAt) : null,
    resolutionNote: unverified?.resolutionNote ?? null,
    notes: fact.notes ?? null,
  };
}

export async function seedCountryIdentifierRequirements(
  prisma: PrismaCountryIdentifierRequirementsClient,
  catalog: CountryIdentifierRequirementsCatalog = defaultCountryIdentifierRequirementsCatalog,
  /**
   * Same flag, same default, same reasoning as `country-policy/seed.ts`'s own
   * `seedCountryPolicies` parameter of the identical name — see that function's own doc comment for
   * the full "rolling deployment" account; it applies here verbatim, table name swapped.
   * `true` by default for this function's two deliberate, single-writer callers (`prisma/seed.ts`,
   * `sync-schema.ts`'s production API-role boot); `boot-reseed.ts#detectAndReseedCountryIdentifierRequirementsDrift`
   * — the ONLINE, per-process-boot correction running in EVERY replica on EVERY boot — passes `false`,
   * so a replica still running yesterday's (shorter) catalog can never delete a country a newer
   * replica already seeded.
   */
  purgeRemovedCountries = true,
): Promise<CountryIdentifierRequirementsSeedSummary> {
  const countries = catalog.countries();

  // Second, independent gate — data/all.ts already validates every fact when a JSON file is
  // loaded, but this function takes a `CountryIdentifierRequirementsCatalog`, not a file path: a
  // catalog built by hand (a test, a future caller) must be refused here too, never trusted just
  // because it made it this far. Validated for EVERY country, BEFORE writing a single row for ANY
  // of them — same "fail the whole seed" discipline as country-policy/seed.ts.
  for (const countryCode of countries) {
    for (const fact of catalog.schemesFor(countryCode)) {
      assertValidProvenance(fact, `seedCountryIdentifierRequirements(${countryCode})`);
      assertPatternIsExplainable(fact, `seedCountryIdentifierRequirements(${countryCode})`);
    }
  }

  let upserted = 0;
  let deleted = 0;

  for (const countryCode of countries) {
    const facts = catalog.schemesFor(countryCode);
    const keepKeys = new Set(facts.map((f) => f.scheme));

    await prisma.$transaction(async (tx) => {
      for (const fact of facts) {
        const row = rowFor(countryCode, fact);
        await tx.countryIdentifierRequirement.upsert({
          where: { countryCode_scheme: { countryCode, scheme: fact.scheme } },
          create: row,
          update: {
            appliesTo: row.appliesTo,
            label: row.label,
            required: row.required,
            pattern: row.pattern,
            helpText: row.helpText,
            provenanceKind: row.provenanceKind,
            sourceText: row.sourceText,
            sourceCheckedAt: row.sourceCheckedAt,
            resolutionNote: row.resolutionNote,
            notes: row.notes,
          },
        });
        upserted++;
      }

      const existing = await tx.countryIdentifierRequirement.findMany({
        where: { countryCode },
        select: COUNTRY_IDENTIFIER_REQUIREMENT_ROW_SELECT,
      });
      const stale = existing.filter((row) => !keepKeys.has(row.scheme));
      if (stale.length > 0) {
        await tx.countryIdentifierRequirement.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
        deleted += stale.length;
      }
    });
  }

  // Whole-country purge — the known gap ("`country-identifiers/seed.ts` never purges
  // a country that has been entirely removed"): the loop above only ever opens a
  // transaction for a country the FILES still name (`countries`, from `catalog.countries()`), so a
  // country dropped from `data/*.json` entirely is never visited by it at all — its rows would
  // otherwise survive forever. One query outside any per-country transaction, precisely because it
  // has to reach rows for countries the loop above never touched.
  //
  // Gated on `purgeRemovedCountries` — see this function's own parameter doc comment (and
  // country-policy/seed.ts's own, which this mirrors) for why: skipping it never leaves a stale
  // SCHEME behind for a country still in the catalog (the per-country loop above, unaffected by this
  // flag) — it only ever means "a country absent from THIS run's catalog keeps its existing rows".
  if (purgeRemovedCountries) {
    const keepCountries = new Set(countries);
    const allRows = await prisma.countryIdentifierRequirement.findMany({
      select: COUNTRY_IDENTIFIER_REQUIREMENT_ROW_SELECT,
    });
    const wholeCountryStale = allRows.filter((row) => !keepCountries.has(row.countryCode));
    if (wholeCountryStale.length > 0) {
      await prisma.countryIdentifierRequirement.deleteMany({
        where: { id: { in: wholeCountryStale.map((row) => row.id) } },
      });
      deleted += wholeCountryStale.length;
    }
  }

  return { upserted, deleted };
}
