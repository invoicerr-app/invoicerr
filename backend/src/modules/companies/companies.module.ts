import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompanyModule } from '@/modules/company/company.module';
import { DocumentsCoreModule } from '@/modules/documents/documents-core.module';
import { BillingExportService } from '@/modules/billing/export-zip.service';
import { MailService } from '@/mail/mail.service';
import { Module } from '@nestjs/common';

@Module({
  // `DocumentsCoreModule` (never the full `DocumentsModule`, which also carries the documents HTTP
  // controller/SSE bridge this module has no use for) — `BillingExportService`'s own dependency,
  // needed here for the self-service full export route (`CompaniesService#exportCompanyData`). This
  // module never imports `BillingModule` itself: that module only exists at all behind the hosted-
  // billing flag (`billing.module.ts`'s own header), and the export right this route serves must work
  // on every instance, self-hosted included — the exact same standalone placement `DangerModule`
  // already holds for its own "delete company" export mail, for the same reason.
  imports: [CompanyModule, DocumentsCoreModule],
  controllers: [CompaniesController],
  providers: [CompaniesService, MailService, BillingExportService],
})
export class CompaniesModule {}
