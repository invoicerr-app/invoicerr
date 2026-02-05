import { JwtService } from '@nestjs/jwt';
import { MailService } from '@/mail/mail.service';
import { Module } from '@nestjs/common';
import { ReceiptsController } from '@/modules/receipts/receipts.controller';
import { ReceiptsService } from '@/modules/receipts/receipts.service';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
    imports: [WebhooksModule],
    controllers: [ReceiptsController],
    providers: [ReceiptsService, MailService, JwtService]
})
export class ReceiptsModule { }
