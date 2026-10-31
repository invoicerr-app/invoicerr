import { ClientsController } from '@/modules/clients/clients.controller';
import { ClientsService } from '@/modules/clients/clients.service';
import { JwtService } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ViesProvider } from '../company-lookup/providers/vies.provider';
import {
  FakeSyntaxOnlyVatValidationClient,
  NullVatValidationClient,
  VatValidationPort,
  ViesVatValidationClient,
} from '../documents/tax/vat-validation';
import { ClientImportController } from './import/client-import.controller';
import { ClientImportService } from './import/client-import.service';

/**
 * VIES is called only outside tests: e2e must never depend on a public registry being up.
 * `VAT_VALIDATION_FAKE=1` swaps in the syntax-only fake for the reverse-charge browser scenario;
 * the null client answers UNAVAILABLE, which is true when the question was never asked.
 */
function vatValidationClient(): VatValidationPort {
  if (process.env.VAT_VALIDATION_FAKE === '1') return new FakeSyntaxOnlyVatValidationClient();
  if (process.env.NODE_ENV === 'test') return new NullVatValidationClient();
  return new ViesVatValidationClient(new ViesProvider());
}

@Module({
  imports: [WebhooksModule],
  // More specific `clients/import/*` routes before ClientsController's own `:id` wildcard.
  controllers: [ClientImportController, ClientsController],
  providers: [
    ClientsService,
    ClientImportService,
    JwtService,
    // A missing provider is a boot error. VIES failures degrade to UNAVAILABLE, never an exception.
    { provide: 'VAT_VALIDATION_CLIENT', useFactory: vatValidationClient },
  ],
  exports: [ClientsService],
})
export class ClientsModule {}
