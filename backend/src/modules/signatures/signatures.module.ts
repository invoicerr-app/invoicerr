import { Module } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { MailModule } from "@/mail/mail.module";
import { SignaturesController } from "@/modules/signatures/signatures.controller";
import { SignaturesService } from "@/modules/signatures/signatures.service";
import { PluginsService } from "../plugins/plugins.service";
import { WebhooksModule } from "../webhooks/webhooks.module";

@Module({
	imports: [WebhooksModule, MailModule],
	controllers: [SignaturesController],
	providers: [SignaturesService, JwtService, PluginsService],
})
export class SignaturesModule {}
