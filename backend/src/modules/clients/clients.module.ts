import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ClientsController } from '@/modules/clients/clients.controller';
import { ClientsService } from '@/modules/clients/clients.service';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [WebhooksModule],
  controllers: [ClientsController],
  providers: [ClientsService, JwtService],
})
export class ClientsModule {}
