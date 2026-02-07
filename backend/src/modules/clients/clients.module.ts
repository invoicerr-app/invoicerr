import { Module } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ClientsController } from "@/modules/clients/clients.controller";
import { ClientsService } from "@/modules/clients/clients.service";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { TenantModule } from "../tenant/tenant.module";

@Module({
	imports: [WebhooksModule, TenantModule],
	controllers: [ClientsController],
	providers: [ClientsService, JwtService],
})
export class ClientsModule {}
