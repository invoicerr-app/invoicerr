import { Module } from '@nestjs/common';

import { CountryReadinessController } from './country-readiness.controller';
import { CountryReadinessService } from './country-readiness.service';

/**
 * Deliberately its own tiny module rather than folded into `documents/` or `company/`: it needs no
 * Prisma, no `@ActiveCompany()`-scoped state, and no dependency on either module's providers — just
 * the five core mechanisms' own `data/all.ts` catalogs (already exported for exactly this kind of
 * read). Keeping it separate means it can be reached by an authenticated user who has no active
 * company yet (company creation itself) without pulling in everything `DocumentsModule` wires for a
 * company that already exists.
 */
@Module({
  controllers: [CountryReadinessController],
  providers: [CountryReadinessService],
  exports: [CountryReadinessService],
})
export class CountryReadinessModule {}
