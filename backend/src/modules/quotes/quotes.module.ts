import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { QuotesController } from '@/modules/quotes/quotes.controller';
import { QuotesService } from '@/modules/quotes/quotes.service';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule],
  controllers: [QuotesController],
  providers: [QuotesService, JwtService],
})
export class QuotesModule {}
