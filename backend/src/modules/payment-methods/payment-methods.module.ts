import { Module } from "@nestjs/common";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { PaymentMethodsController } from "./payment-methods.controller";
import { PaymentMethodsService } from "./payment-methods.service";

@Module({
	imports: [WebhooksModule],
	providers: [PaymentMethodsService],
	controllers: [PaymentMethodsController],
	exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
