import { Module } from '@nestjs/common';

import { AccountingExportController } from './accounting-export.controller';

/**
 * TODO_FEATURES.md rank 4 — deliberately its OWN module, not folded into `DocumentsModule`/
 * `DocumentsCoreModule`: `accounting-export.service.ts` is a self-contained function needing NO
 * injected provider at all (it reads the `prisma` singleton directly and calls the settlement/totals
 * PURE helpers `documents/settlement`/`documents/totals` already export — see that file's own header),
 * so there is no reason to route this one read-only endpoint through `DocumentsCoreModule`'s much
 * larger provider graph. Imported directly by `AppModule`, exactly like `DocumentsModule` itself.
 */
@Module({
  controllers: [AccountingExportController],
})
export class AccountingExportModule {}
