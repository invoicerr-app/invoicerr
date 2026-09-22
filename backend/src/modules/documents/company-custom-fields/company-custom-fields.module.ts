import { Module } from '@nestjs/common';

import { DocumentsCoreModule } from '../documents-core.module';
import { CompanyCustomFieldsController } from './company-custom-fields.controller';
import { CompanyCustomFieldsService } from './company-custom-fields.service';

/**
 * The HTTP half of company-custom-fields/ — registered directly in `AppModule`, alongside (not
 * inside) `DocumentsModule`, the same "type-adjacent, standalone module" placement
 * `PaymentMethodsModule` already holds: a custom field DEFINITION is a company-level setting, not a
 * `DocumentTypeDescriptor`. Imports `DocumentsCoreModule` only for the module-loading convention
 * every sibling here follows (see `PaymentMethodsModule`'s own header) — `CompanyCustomFieldsService`
 * itself needs nothing from it, every actual dependency (prisma, the field-kind registry) is a plain,
 * directly-imported singleton.
 */
@Module({
  imports: [DocumentsCoreModule],
  controllers: [CompanyCustomFieldsController],
  providers: [CompanyCustomFieldsService],
})
export class CompanyCustomFieldsModule {}
