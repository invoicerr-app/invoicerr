import { CompanyController } from '@/modules/company/company.controller';
import { CompanyService } from '@/modules/company/company.service';
import { JwtService } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { CurrencyRatesController } from './currency-rates/currency-rates.controller';
import { CurrencyRatesService } from './currency-rates/currency-rates.service';

@Module({
  imports: [WebhooksModule],
  controllers: [CompanyController, CurrencyRatesController],
  providers: [CompanyService, JwtService, CurrencyRatesService],
  exports: [CompanyService],
})
export class CompanyModule {}
