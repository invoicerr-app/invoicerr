import { CompanyController } from '@/modules/company/company.controller';
import { CompanyService } from '@/modules/company/company.service';
import { JwtService } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ChannelsController } from './channels/channels.controller';
import { ChannelCredentialsService } from './channels/channels.service';
import { CurrencyRatesController } from './currency-rates/currency-rates.controller';
import { CurrencyRatesService } from './currency-rates/currency-rates.service';

@Module({
  imports: [WebhooksModule],
  controllers: [CompanyController, CurrencyRatesController, ChannelsController],
  providers: [CompanyService, JwtService, CurrencyRatesService, ChannelCredentialsService],
  // `ChannelCredentialsService` is exported so `DocumentsCoreModule` can inject it into the "pdp"
  // transport (`documents/transports/pdp-transport.ts`) — the same cross-module reuse
  // `ClientsService`/`MailService` already get for the "email" one, nothing bespoke.
  exports: [CompanyService, ChannelCredentialsService],
})
export class CompanyModule {}
