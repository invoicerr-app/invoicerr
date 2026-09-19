import { MailService } from '@/mail/mail.service';
import { DangerController } from '@/modules/danger/danger.controller';
import { DangerService } from '@/modules/danger/danger.service';
import { DocumentsCoreModule } from '@/modules/documents/documents-core.module';
import { BillingExportService } from '@/modules/billing/export-zip.service';
import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Module({
  // `DocumentsCoreModule` (never the full `DocumentsModule`, which also carries the documents HTTP
  // controller/SSE bridge this module has no use for), for `DocumentsService` alone —
  // `BillingExportService`'s own dependency, "Reset company data"'s way of building the same full
  // data export the SaaS deletion path already mails an OWNER (`billing/export-zip.service.ts`). The
  // exact same "Core, not the whole HTTP module" placement `BillingModule`/`PaymentsModule` already
  // hold, each for the same reason (see their own module headers).
  imports: [DocumentsCoreModule],
  controllers: [DangerController],
  providers: [DangerService, MailService, JwtService, BillingExportService],
})
export class DangerModule {}
