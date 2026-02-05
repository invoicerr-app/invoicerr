import { MailService } from "@/mail/mail.service";
import { DangerController } from "@/modules/danger/danger.controller";
import { DangerService } from "@/modules/danger/danger.service";
import { Module } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

@Module({
  controllers: [DangerController],
  providers: [DangerService, MailService, JwtService]
})
export class DangerModule { }
