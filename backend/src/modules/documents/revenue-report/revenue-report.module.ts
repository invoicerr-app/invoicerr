import { Module } from '@nestjs/common';

import { RevenueReportController } from './revenue-report.controller';

/**
 * Deliberately its own module, not folded into `DocumentsModule`/`DocumentsCoreModule` - same
 * reasoning `accounting-export.module.ts`'s own header gives verbatim: `revenue-report.service.ts` is
 * a self-contained set of functions needing no injected provider (reads the `prisma` singleton
 * directly, calls the pure `cashed-revenue.ts` helpers and `contributions/currency-consolidation.ts`'s
 * own `loadCurrencyContext`), so there is no reason to route these two read-only endpoints through
 * `DocumentsCoreModule`'s much larger provider graph. Imported directly by `AppModule`, exactly like
 * `AccountingExportModule` itself.
 */
@Module({
  controllers: [RevenueReportController],
})
export class RevenueReportModule {}
