import { CompanyController } from '@/modules/company/company.controller';
import { CompanyService } from '@/modules/company/company.service';
import { MailService } from '@/mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AtcudSeriesController } from './atcud-series/atcud-series.controller';
import { AtcudSeriesService } from './atcud-series/atcud-series.service';
import { BrandingController } from './branding/branding.controller';
import { BrandingService } from './branding/branding.service';
import { ChannelsController } from './channels/channels.controller';
import { ChannelCredentialsService } from './channels/channels.service';
import { CurrencyRatesController } from './currency-rates/currency-rates.controller';
import { CurrencyRatesService } from './currency-rates/currency-rates.service';
import { CompanyMailSettingsService } from './mail-settings/company-mail-settings.service';
import { SigningCertificatesController } from './signing-certificates/signing-certificates.controller';
import { SigningCertificatesService } from './signing-certificates/signing-certificates.service';
import { SsoController } from './sso/sso.controller';
import { SsoLookupController } from './sso/sso-lookup.controller';
import { SsoRegistrarService } from './sso/sso-registrar.service';
import { SSO_REGISTRY_SYNC } from './sso/sso-registry-sync';
import { SsoRegistrySyncService } from './sso/sso-registry-sync.service';
import { SsoService } from './sso/sso.service';

@Module({
  imports: [WebhooksModule],
  controllers: [
    CompanyController,
    CurrencyRatesController,
    ChannelsController,
    BrandingController,
    SigningCertificatesController,
    AtcudSeriesController,
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
    BrandingService,
    SigningCertificatesService,
    AtcudSeriesService,
    SsoService,
    // Registers every company's own OIDC provider with the live better-auth instance at boot
    // (`OnModuleInit`) and on every write — see sso-registrar.service.ts's own header for why
    // post-boot insertion into `auth.$context.socialProviders` is visible immediately.
    SsoRegistrarService,
    // Cross-replica pub/sub for that same registration — see sso-registry-sync.service.ts's
    // own header. `SsoRegistrarService` injects it BY TOKEN (`SSO_REGISTRY_SYNC`,
    // sso-registry-sync.ts's own comment on why), so both the concrete class AND the token alias are
    // provided here.
    SsoRegistrySyncService,
    { provide: SSO_REGISTRY_SYNC, useExisting: SsoRegistrySyncService },
    // Plain, empty-constructor leaf provider (see mail.service.ts's own header) — listed here the
    // same way plugins.module.ts/danger.module.ts/documents-core.module.ts each independently list
    // it in their OWN providers array; a second instance costs nothing.
    // `CompanyMailSettingsService#sendTest` (the mail-server cascade's test-send) is this module's own
    // caller.
    MailService,
    CompanyMailSettingsService,
  ],
  // `ChannelCredentialsService`/`SigningCertificatesService` are exported so `DocumentsCoreModule` can
  // inject them (into the "pdp" transport, and into the PAdES signing wiring,
  // `documents/signing/sign-instance-pdf.ts`) — the same cross-module reuse `ClientsService`/
  // `MailService` already get for the "email" transport, nothing bespoke.
  exports: [CompanyService, ChannelCredentialsService, SigningCertificatesService, SsoService],
})
export class CompanyModule {}
