/**
 * Runs `detectAndReseedCountryPolicyDrift` on EVERY backend boot — modeled directly on
 * `b2g-routing/boot-upsert.service.ts` (same `OnModuleInit` shape, same "NEVER throws" choice, same
 * registration site in `documents-core.module.ts`). See `boot-reseed.ts` for what changed relative
 * to that precedent (a detect-first, write-only-if-needed step) and why.
 *
 * DECISION — this ALSO runs, unconditionally, in production, alongside `sync-schema.ts`'s own
 * `seedCountryPolicies` call (production API-role boot, BEFORE Nest even starts — see `main.ts`).
 * That is deliberate, not an oversight of "this should be dev/test only":
 *
 *  1. `sync-schema.ts` is invoked from `main.ts` for the **API role only** (`NODE_ENV=production`
 *     gate right there). `ROLE=worker` boots `worker.ts` → `NestFactory.createApplicationContext`
 *     directly — see that file's own header: "no migrations (those are API-only)". A worker replica
 *     imports `DocumentsCoreModule` too (`document-queue-worker.module.ts`), so without an
 *     `OnModuleInit` of its own, a worker-only process would never re-check this table at all —
 *     forever trusting whatever it happened to inherit from the database.
 *  2. It is idempotent and, thanks to the drift check, a genuine no-op when the table already
 *     matches the files (the overwhelmingly common case for a production API-role boot, since
 *     `sync-schema.ts` just finished the real reseed moments earlier) — so the "also run it here"
 *     redundancy on the API role costs one read query, not a wasted write.
 *  3. This is the exact choice the codebase already made for `B2gRoutingRule`
 *     (`b2g-routing/boot-upsert.service.ts`, `schema.prisma`'s own comment on that model): run the
 *     idempotent correction from `OnModuleInit`, in every process, in every environment, rather than
 *     branch on `NODE_ENV`. Branching here would reintroduce the exact "a human has to remember a
 *     manual step, or trust an assumption about which role is running" gap this whole mechanism
 *     exists to remove — and would leave a still-unfixed asymmetry between this table and
 *     `B2gRoutingRule`, which already has no such branch.
 *
 * Refusing to reseed in production was the other option considered, gated on logging
 * the drift loudly instead of correcting it silently. That path was not taken: this codebase already
 * has a stronger, working precedent (`B2gRoutingRule`) for "just correct it, safely, everywhere" —
 * preferred here over inventing a softer, log-only stance for one table but not its sibling.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { detectAndReseedCountryPolicyDrift } from './boot-reseed';

@Injectable()
export class CountryPolicyBootReseedService implements OnModuleInit {
  private readonly logger = new Logger(CountryPolicyBootReseedService.name);

  async onModuleInit(): Promise<void> {
    try {
      const summary = await detectAndReseedCountryPolicyDrift(prisma);

      if (!summary.reseeded) {
        this.logger.log(
          'Document country-action policy already matches data/*.json at boot — no reseed needed.',
        );
        return;
      }

      this.logger.warn(
        'Document country-action policy DRIFTED from data/*.json at boot — ' +
          `added: [${summary.drift.addedCountries.join(', ')}], ` +
          `changed: [${summary.drift.changedCountries.join(', ')}], ` +
          `removed: [${summary.drift.removedCountries.join(', ')}]. ` +
          `Reseeded: ${summary.upserted} upserted, ${summary.deleted} deleted (stale).`,
      );
    } catch (error) {
      // NEVER throws, same reasoning as B2gRoutingBootUpsertService's own header: a startup-time DB
      // hiccup here must not crash the whole app. A stale/missing rule degrades to the existing,
      // already-loud refusal at request time (country-policy.ts's evaluateCountryPolicy — a named
      // 403, never a silent one), never a worse failure than what this mechanism already guarded
      // against before it existed. Failing the whole boot on a transient DB blip would be strictly
      // worse for a correction this narrow.
      this.logger.error(
        'Failed to detect/reseed document country-action policy drift at boot — a stale or missing ' +
          'rule may 403 every document action for an affected country until this succeeds on a ' +
          `later boot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
