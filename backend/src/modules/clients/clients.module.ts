import { ClientsController } from '@/modules/clients/clients.controller';
import { ClientsService } from '@/modules/clients/clients.service';
import { JwtService } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { NullVatValidationClient } from '@/compliance/canonical/vat-validation.port';
import { ViesVatValidationClient } from '@/compliance/canonical/vies-vat-validation.client';

/**
 * VIES is reached when a VAT number is entered — EXCEPT under NODE_ENV=test.
 *
 * `16-company-lookup.cy.ts` states the rule this honours: "a CI job must never depend on INSEE or
 * VIES being up". The e2e suite types real-looking VAT numbers into the client form, and each one
 * would otherwise become an outbound SOAP call to the European Commission — up to 8 s each, from
 * CI, against a service that rate-limits. That is both slow and the wrong thing to ask of a public
 * registry on every push.
 *
 * The null client is not a mock that pretends: it returns UNAVAILABLE, which is exactly true — the
 * question was never asked. So the write path still runs end to end in e2e (a row IS persisted,
 * with a status, a date and a source), and the conservative branch is the one exercised: an
 * unverified number keeps standard-rate VAT. What e2e cannot cover is the VALID -> AE transition,
 * because that needs an answer only VIES can give; `vat-validation-e2e.spec.ts` covers it with an
 * injected fake, and `company-lookup.live` covers the real service on demand.
 */
function vatValidationClient() {
  return process.env.NODE_ENV === 'test' ? new NullVatValidationClient() : new ViesVatValidationClient();
}

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
    { provide: 'VAT_VALIDATION_CLIENT', useFactory: vatValidationClient },
  ],
  exports: [ClientsService],
})
export class ClientsModule {}
