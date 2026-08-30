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
import { assertValidProvenance, IdentifierSchemeFact, LegalProvenance, UnverifiedProvenance } from './schema';
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

export interface PrismaCountryIdentifierRequirementsClient {
  countryIdentifierRequirement: {
    upsert: (args: {
      where: { countryCode_scheme: { countryCode: string; scheme: string } };
      create: CountryIdentifierRequirementRow;
      update: Omit<CountryIdentifierRequirementRow, 'countryCode' | 'scheme'>;
    }) => Promise<unknown>;
    findMany: (args: {
      where: { countryCode: string };
      select: { id: true; scheme: true };
    }) => Promise<{ id: string; scheme: string }[]>;
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

function rowFor(countryCode: string, fact: IdentifierSchemeFact): CountryIdentifierRequirementRow {
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
): Promise<CountryIdentifierRequirementsSeedSummary> {
  const countries = catalog.countries();

  // Second, independent gate — data/all.ts already validates every fact when a JSON file is
  // loaded, but this function takes a `CountryIdentifierRequirementsCatalog`, not a file path: a
  // catalog built by hand (a test, a future caller) must be refused here too, never trusted just
  // because it made it this far. Validated for EVERY country, BEFORE writing a single row for ANY
  // of them — same "fais échouer le semis entier" discipline as country-policy/seed.ts.
  for (const countryCode of countries) {
    for (const fact of catalog.schemesFor(countryCode)) {
      assertValidProvenance(fact, `seedCountryIdentifierRequirements(${countryCode})`);
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
        select: { id: true, scheme: true },
      });
      const stale = existing.filter((row) => !keepKeys.has(row.scheme));
      if (stale.length > 0) {
        await tx.countryIdentifierRequirement.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
        deleted += stale.length;
      }
    });
  }

  return { upserted, deleted };
}
