import { ClientsController } from '@/modules/clients/clients.controller';
import { ClientsService } from '@/modules/clients/clients.service';
import { JwtService } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ViesVatValidationClient } from '@/compliance/canonical/vies-vat-validation.client';

@Module({
  imports: [WebhooksModule],
  controllers: [ClientsController],
  providers: [
    ClientsService,
    JwtService,
    // C4 — the VAT validation client, WIRED. Without this provider ClientsService cannot be
    // constructed, so the wiring cannot be forgotten the way ComplianceService's format registry
    // was (P1-T03a): there, an optional constructor argument silently fell back to an unwired
    // singleton and nothing failed. Here a missing provider is a boot error.
    //
    // ViesVatValidationClient talks to the European Commission's public service — no credentials,
    // and a failure is an UNAVAILABLE verdict rather than an exception, so a saturated VIES delays
    // a form submission and never blocks an invoice.
    { provide: 'VAT_VALIDATION_CLIENT', useFactory: () => new ViesVatValidationClient() },
  ],
  exports: [ClientsService],
})
export class ClientsModule {}
