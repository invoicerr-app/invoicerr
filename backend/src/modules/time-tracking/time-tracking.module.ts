import { Module } from '@nestjs/common';

import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { TimeEntriesController } from './time-entries.controller';
import { TimeEntriesService } from './time-entries.service';

/**
 * Time tracking & project invoicing ("suivi du temps & facturation de projets"). Self-contained, like
 * ArticlesModule: every lookup (client ownership, company currency) goes through the shared `prisma`
 * singleton directly, and the invoice draft this module creates (`TimeEntriesService.billToInvoice`)
 * is a plain `prisma.documentInstance.create` — the same bypass `actions/quote-to-invoice.ts` already
 * uses for "convert-to-invoice"/"request-deposit" — so this module needs no dependency on
 * DocumentsCoreModule at all.
 */
@Module({
  providers: [ProjectsService, TimeEntriesService],
  controllers: [ProjectsController, TimeEntriesController],
  exports: [ProjectsService, TimeEntriesService],
})
export class TimeTrackingModule {}
