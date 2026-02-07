import { Module } from "@nestjs/common";
import { MailModule } from "@/mail/mail.module";
import { DangerController } from "@/modules/danger/danger.controller";
import { DangerService } from "@/modules/danger/danger.service";

@Module({
	controllers: [DangerController],
	providers: [DangerService],
	imports: [MailModule],
})
export class DangerModule {}
