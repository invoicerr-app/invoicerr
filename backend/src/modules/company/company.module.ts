import { CompanyController } from '@/modules/company/company.controller';
import { CompanyService } from '@/modules/company/company.service';
import { JwtService } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ChannelsController } from './channels/channels.controller';
import { ChannelCredentialsService } from './channels/channels.service';
import { CurrencyRatesController } from './currency-rates/currency-rates.controller';
import { CurrencyRatesService } from './currency-rates/currency-rates.service';
import { SigningCertificatesController } from './signing-certificates/signing-certificates.controller';
import { SigningCertificatesService } from './signing-certificates/signing-certificates.service';
import { SsoController } from './sso/sso.controller';
import { SsoLookupController } from './sso/sso-lookup.controller';
import { SsoRegistrarService } from './sso/sso-registrar.service';
import { SsoService } from './sso/sso.service';

@Module({
  imports: [WebhooksModule],
  controllers: [
    CompanyController,
    CurrencyRatesController,
    ChannelsController,
    SigningCertificatesController,
    SsoController,
    // The ONE anonymous SSO route, on its own path ("/api/sso/lookup") and in its own controller so it
    // cannot share `@Public()` with the company-scoped one — see its own header.
    SsoLookupController,
  ],
  providers: [
    CompanyService,
    JwtService,
    CurrencyRatesService,
    ChannelCredentialsService,
    SigningCertificatesService,
    SsoService,
    // Registers every company's own OIDC provider with the live better-auth instance at boot
    // (`OnModuleInit`) and on every write — see sso-registrar.service.ts's own header for why
    // post-boot insertion into `auth.$context.socialProviders` is visible immediately.
    SsoRegistrarService,
  ],
  // `ChannelCredentialsService`/`SigningCertificatesService` are exported so `DocumentsCoreModule` can
  // inject them (into the "pdp" transport, and into the PAdES signing wiring,
  // `documents/signing/sign-instance-pdf.ts`) — the same cross-module reuse `ClientsService`/
  // `MailService` already get for the "email" transport, nothing bespoke.
  exports: [CompanyService, ChannelCredentialsService, SigningCertificatesService, SsoService],
})
export class CompanyModule {}
