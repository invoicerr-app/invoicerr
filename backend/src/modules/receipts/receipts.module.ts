import { Module } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { MailModule } from "@/mail/mail.module";
import { ReceiptsController } from "@/modules/receipts/receipts.controller";
import { ReceiptsService } from "@/modules/receipts/receipts.service";
import { WebhooksModule } from "../webhooks/webhooks.module";

@Module({
	imports: [WebhooksModule, MailModule],
	controllers: [ReceiptsController],
	providers: [ReceiptsService, JwtService],
})
export class ReceiptsModule {}
