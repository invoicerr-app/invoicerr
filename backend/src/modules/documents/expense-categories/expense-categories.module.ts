import { Module } from '@nestjs/common';

import { DocumentsCoreModule } from '../documents-core.module';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { ExpenseCategoriesService } from './expense-categories.service';

/**
 * The HTTP half of expense-categories/ — registered directly in `AppModule`, alongside (not inside)
 * `DocumentsModule`, the same "type-adjacent, standalone module" placement `CompanyCustomFieldsModule`
 * already holds. Imports `DocumentsCoreModule` only for the module-loading convention every sibling
 * here follows (see `CompanyCustomFieldsModule`'s own header) — `ExpenseCategoriesService` itself needs
 * nothing from it, every actual dependency (prisma) is a plain, directly-imported singleton.
 *
 * UNLIKE `CompanyCustomFieldsModule` (a top-level `custom-fields` path), this controller's routes live
 * UNDER `documents/` (`documents/expense-categories`) and declare a BARE list/create route with no
 * further segment — which is exactly the shape `DocumentsController`'s own catch-all `GET ':id'`
 * would otherwise shadow. See `app.module.ts`'s own comment on where this module is positioned in the
 * `imports` array (BEFORE `DocumentsModule`) for why that alone is what makes these routes reachable.
 */
@Module({
  imports: [DocumentsCoreModule],
  controllers: [ExpenseCategoriesController],
  providers: [ExpenseCategoriesService],
})
export class ExpenseCategoriesModule {}
