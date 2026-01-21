import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '@/mail/mail.service';
import { PluginsController } from '@/modules/plugins/plugins.controller';
import { PluginsService } from '@/modules/plugins/plugins.service';

@Module({
  controllers: [PluginsController],
  providers: [PluginsService, MailService, JwtService],
  exports: [PluginsService],
})
export class PluginsModule {}
