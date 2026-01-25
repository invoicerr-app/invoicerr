import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '@/mail/mail.service';
import { ReceiptsController } from '@/modules/receipts/receipts.controller';
import { ReceiptsService } from '@/modules/receipts/receipts.service';
import { ComplianceModule } from '../compliance/compliance.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule, ComplianceModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService, MailService, JwtService],
})
export class ReceiptsModule {}
