import { JwtService } from '@nestjs/jwt';
import { MailService } from '@/mail/mail.service';
import { Module } from '@nestjs/common';
import { PaymentsController } from '@/modules/payments/payments.controller';
import { PaymentsService } from '@/modules/payments/payments.service';
import { ReceiptsDeprecatedController } from '@/modules/payments/receipts-deprecated.controller';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ComplianceModule } from '@/compliance/nest/compliance.module';

@Module({
    imports: [WebhooksModule, ComplianceModule],
    controllers: [PaymentsController, ReceiptsDeprecatedController],
    providers: [PaymentsService, MailService, JwtService]
})
export class PaymentsModule { }
