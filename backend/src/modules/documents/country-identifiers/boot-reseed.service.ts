/**
 * Runs `detectAndReseedCountryIdentifierRequirementsDrift` on EVERY backend boot — the sibling of
 * `country-policy/boot-reseed.service.ts`; see that file's own header for the full DECISION
 * reasoning (why this also runs, unconditionally, in production, alongside every other environment)
 * — it applies here verbatim, table name swapped.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { detectAndReseedCountryIdentifierRequirementsDrift } from './boot-reseed';

@Injectable()
export class CountryIdentifierRequirementsBootReseedService implements OnModuleInit {
  private readonly logger = new Logger(CountryIdentifierRequirementsBootReseedService.name);

  async onModuleInit(): Promise<void> {
    try {
      const summary = await detectAndReseedCountryIdentifierRequirementsDrift(prisma);

      if (!summary.reseeded) {
        this.logger.log(
          'Country identifier requirements already match data/*.json at boot — no reseed needed.',
        );
        return;
      }

      this.logger.warn(
        'Country identifier requirements DRIFTED from data/*.json at boot — ' +
          `added: [${summary.drift.addedCountries.join(', ')}], ` +
          `changed: [${summary.drift.changedCountries.join(', ')}], ` +
          `removed: [${summary.drift.removedCountries.join(', ')}]. ` +
          `Reseeded: ${summary.upserted} upserted, ${summary.deleted} deleted (stale).`,
      );
    } catch (error) {
      // NEVER throws — same reasoning as country-policy/boot-reseed.service.ts's own catch: a
      // startup-time DB hiccup here must not crash the whole app. A stale/missing requirement
      // degrades to the existing, already-loud handling at request time
      // (country-identifiers.ts's resolveRequiredIdentifiers — a named `reason`, never a silent
      // empty form), never a worse failure than what this mechanism already guarded against before
      // it existed.
      this.logger.error(
        'Failed to detect/reseed country identifier requirements drift at boot — a stale or ' +
          "missing requirement may misreport a country's identifier fields until this succeeds on " +
          `a later boot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
