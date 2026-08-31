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

@Module({
  imports: [WebhooksModule],
  controllers: [
    CompanyController,
    CurrencyRatesController,
    ChannelsController,
    SigningCertificatesController,
  ],
  providers: [
    CompanyService,
    JwtService,
    CurrencyRatesService,
    ChannelCredentialsService,
    SigningCertificatesService,
  ],
  // `ChannelCredentialsService`/`SigningCertificatesService` are exported so `DocumentsCoreModule` can
  // inject them (into the "pdp" transport, and into the PAdES signing wiring — root TODO item 13,
  // `documents/signing/sign-instance-pdf.ts`) — the same cross-module reuse `ClientsService`/
  // `MailService` already get for the "email" transport, nothing bespoke.
  exports: [CompanyService, ChannelCredentialsService, SigningCertificatesService],
})
export class CompanyModule {}
