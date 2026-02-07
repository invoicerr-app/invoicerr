import { Module } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { MailModule } from "@/mail/mail.module";
import { PluginsController } from "@/modules/plugins/plugins.controller";
import { PluginsService } from "@/modules/plugins/plugins.service";

@Module({
	controllers: [PluginsController],
	providers: [PluginsService, JwtService],
	imports: [MailModule],
	exports: [PluginsService],
})
export class PluginsModule {}
