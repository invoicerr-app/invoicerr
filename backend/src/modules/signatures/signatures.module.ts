import { JwtService } from '@nestjs/jwt';
import { MailService } from '@/mail/mail.service';
import { Module } from '@nestjs/common';
import { PluginsService } from '../plugins/plugins.service';
import { SignaturesController } from '@/modules/signatures/signatures.controller';
import { SignaturesService } from '@/modules/signatures/signatures.service';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule],
  controllers: [SignaturesController],
  providers: [SignaturesService, MailService, JwtService, PluginsService]
})
export class SignaturesModule { }
