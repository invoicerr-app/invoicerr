/**
 * Makes the `DocumentCountryActionRule` table match the policy files exactly — see schema.prisma's
 * own comment on that model, and this directory's schema.ts for what a "rule" is and why it can
 * never exist without a provenance.
 *
 * Idempotent by construction: each row's identity is (countryCode, typeId, actionId) — the same
 * triple every time the files are unchanged — so re-running upserts the same rows (no duplicates)
 * and deletes nothing. Editing a rule's `allowed`/provenance in the file and reseeding updates the
 * row in place. Adding a new (typeId, actionId) pair to a country's file makes a new row appear on
 * the next reseed; removing one makes its row disappear — the file is the ongoing source of truth,
 * not a one-time fixture, exactly the property "adding a rule to the file is enough to make it
 * exist" asks for.
 *
 * Deliberately loosely typed (`PrismaCountryPolicyClient` below, not the generated Prisma Client
 * type): this is an internal seeding utility, not a public API, and the loose shape makes it trivial
 * to drive with a hand-rolled fake in tests (see seed.spec.ts) without depending on
 * `prisma/generated/prisma` in the type signature — the same style the (removed) VAT rate catalog's
 * own seed.ts used, and `InvitationsService.spec` before that.
 */
import {
  assertValidProvenance,
  DocumentActionRuleFact,
  LegalProvenance,
  UnverifiedProvenance,
} from './schema';
import { CountryPolicyCatalog, defaultCountryPolicyCatalog } from './registry';

export interface DocumentCountryActionRuleRow {
  countryCode: string;
  typeId: string;
  actionId: string;
  allowed: boolean;
  provenanceKind: string;
  sourceText: string | null;
  sourceCheckedAt: Date | null;
  resolutionNote: string | null;
  statuses: string[];
  notes: string | null;
}

// The full row shape `findMany` selects, used for BOTH the per-country stale-rule check below AND
// (with no `where` at all) the whole-country purge and drift.ts's own comparison — one select
// clause, so a field neither ever forgets to ask for. `where` is optional for exactly that second,
// table-wide use: Prisma itself treats an absent `where` as "no filter", and the fake client in
// seed.spec.ts must accept the same.
export const COUNTRY_POLICY_ROW_SELECT = {
  id: true,
  countryCode: true,
  typeId: true,
  actionId: true,
  allowed: true,
  provenanceKind: true,
  sourceText: true,
  sourceCheckedAt: true,
  resolutionNote: true,
  statuses: true,
  notes: true,
} as const;

export interface PrismaCountryPolicyClient {
  documentCountryActionRule: {
    upsert: (args: {
      where: {
        countryCode_typeId_actionId: { countryCode: string; typeId: string; actionId: string };
      };
      create: DocumentCountryActionRuleRow;
      update: Omit<DocumentCountryActionRuleRow, 'countryCode' | 'typeId' | 'actionId'>;
    }) => Promise<unknown>;
    findMany: (args: {
      where?: { countryCode: string };
      select: typeof COUNTRY_POLICY_ROW_SELECT;
    }) => Promise<(DocumentCountryActionRuleRow & { id: string })[]>;
    deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<unknown>;
  };
  $transaction: <T>(fn: (tx: PrismaCountryPolicyClient) => Promise<T>) => Promise<T>;
}

export interface CountryPolicySeedSummary {
  /** Rows created or updated (upsert doesn't distinguish the two without an extra read, and the
   *  distinction isn't useful here — both mean "this row now matches the file"). */
  upserted: number;
  /** Rows removed because their (typeId, actionId) is no longer in the file for that country. */
  deleted: number;
}

// Exported for drift.ts: computing "what the DB SHOULD look like for this country" is the exact
// same transform whether it feeds an upsert or a drift comparison — one function, never two
// versions that could quietly diverge.
export function rowFor(countryCode: string, rule: DocumentActionRuleFact): DocumentCountryActionRuleRow {
  const legal = rule.provenance.kind === 'legal' ? (rule.provenance as LegalProvenance) : undefined;
  const unverified =
    rule.provenance.kind === 'unverified' ? (rule.provenance as UnverifiedProvenance) : undefined;

  return {
    countryCode,
    typeId: rule.typeId,
    actionId: rule.actionId,
    allowed: rule.allowed,
    provenanceKind: rule.provenance.kind,
    sourceText: legal?.sourceText ?? null,
    sourceCheckedAt: legal ? new Date(legal.sourceCheckedAt) : null,
    resolutionNote: unverified?.resolutionNote ?? null,
    statuses: rule.statuses ?? [],
    notes: rule.notes ?? null,
  };
}

export async function seedCountryPolicies(
  prisma: PrismaCountryPolicyClient,
  catalog: CountryPolicyCatalog = defaultCountryPolicyCatalog,
  /**
   * Whether to run the WHOLE-COUNTRY purge below at all — `true` by DEFAULT, preserving this
   * function's own "the file is the ongoing source of truth" contract byte for byte for its two
   * DELIBERATE, single-writer callers (`prisma/seed.ts`'s `migrate dev`/`migrate reset`/`db seed`
   * hook, and `sync-schema.ts`'s production API-role boot): a country genuinely dropped from
   * `data/*.json` in a real release IS meant to lose its rows there.
   *
   * `boot-reseed.ts#detectAndReseedCountryPolicyDrift` — the ONLINE, per-process-boot correction that
   * runs in EVERY replica, API and worker alike, on EVERY boot — passes `false`. That path has no
   * business purging a whole country at all: during a rolling deployment, an OLD replica (still
   * running yesterday's image, yesterday's catalog) restarting on its own liveness probe would
   * otherwise see a country the NEW replica already seeded as "removed" (simply absent from the OLD
   * catalog it happens to be running) and DELETE those rows out from under the new image — 403s on
   * every action for that country until the next boot of a new-image replica. An advisory lock would
   * not close this hole: the old replica is not racing a concurrent writer, it is running ALONE with a
   * stale catalog and would, correctly per its OWN view, decide the newer country is stale. Only
   * refusing to purge from the automatic, per-boot path — leaving a REAL country removal to the
   * deliberate, single-run reseed that ships with the release that actually removes it — closes it.
   * `boot-reseed.service.ts`'s own drift-detection LOG still names any such "removed" country, so a
   * genuine, intended removal is still visible, just never silently acted on by a replica that might
   * be the stale one.
   */
  purgeRemovedCountries = true,
): Promise<CountryPolicySeedSummary> {
  const countries = catalog.countries();

  // Second, independent gate — data/all.ts already validates every rule when a JSON file is loaded,
  // but this function takes a `CountryPolicyCatalog`, not a file path: a catalog built by hand (a
  // test, a future caller) must be refused here too, never trusted just because it made it this far.
  // Validated for EVERY country, BEFORE writing a single row for ANY of them: "fail the whole
  // seed" means the whole seed, not just the one country whose file happens to be broken — a
  // country later in iteration order failing must never leave an earlier one half-seeded.
  for (const countryCode of countries) {
    for (const rule of catalog.rulesFor(countryCode)) {
      assertValidProvenance(rule, `seedCountryPolicies(${countryCode})`);
    }
  }

  let upserted = 0;
  let deleted = 0;

  for (const countryCode of countries) {
    const rules = catalog.rulesFor(countryCode);
    const keepKeys = new Set(rules.map((r) => `${r.typeId}::${r.actionId}`));

    await prisma.$transaction(async (tx) => {
      for (const rule of rules) {
        const row = rowFor(countryCode, rule);
        await tx.documentCountryActionRule.upsert({
          where: {
            countryCode_typeId_actionId: { countryCode, typeId: rule.typeId, actionId: rule.actionId },
          },
          create: row,
          update: {
            allowed: row.allowed,
            provenanceKind: row.provenanceKind,
            sourceText: row.sourceText,
            sourceCheckedAt: row.sourceCheckedAt,
            resolutionNote: row.resolutionNote,
            statuses: row.statuses,
            notes: row.notes,
          },
        });
        upserted++;
      }

      const existing = await tx.documentCountryActionRule.findMany({
        where: { countryCode },
        select: COUNTRY_POLICY_ROW_SELECT,
      });
      const stale = existing.filter((row) => !keepKeys.has(`${row.typeId}::${row.actionId}`));
      if (stale.length > 0) {
        await tx.documentCountryActionRule.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
        deleted += stale.length;
      }
    });
  }

  // Whole-country purge — the known remainder ("`country-identifiers/seed.ts` never
  // purges a country that has been entirely removed") names this gap for the sibling table; this one shares
  // it identically, and for the same structural reason: the loop above only ever opens a
  // transaction for a country the FILES still name (`countries`, from `catalog.countries()`). A
  // country dropped from `data/*.json` entirely is never visited by that loop at all, so its rows
  // survive forever without this second, GLOBAL pass — one query outside any per-country
  // transaction, precisely because it has to reach rows for countries the loop above never touched.
  //
  // Gated on `purgeRemovedCountries` — see this function's own parameter doc comment for the full
  // "rolling deployment" scenario this guards against. Skipping the purge never leaves a stale rule
  // BEHIND for a country still in the catalog (that is the per-country loop above, unaffected by this
  // flag) — it only ever means "a country absent from THIS run's catalog keeps its existing rows",
  // which is exactly the safe default for a caller that cannot tell "genuinely removed" apart from
  // "this replica's own catalog just hasn't caught up yet".
  if (purgeRemovedCountries) {
    const keepCountries = new Set(countries);
    const allRows = await prisma.documentCountryActionRule.findMany({ select: COUNTRY_POLICY_ROW_SELECT });
    const wholeCountryStale = allRows.filter((row) => !keepCountries.has(row.countryCode));
    if (wholeCountryStale.length > 0) {
      await prisma.documentCountryActionRule.deleteMany({
        where: { id: { in: wholeCountryStale.map((row) => row.id) } },
      });
      deleted += wholeCountryStale.length;
    }
  }

  return { upserted, deleted };
}
