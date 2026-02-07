import { Module } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { CompanyController } from "@/modules/company/company.controller";
import { CompanyService } from "@/modules/company/company.service";
import { WebhooksModule } from "../webhooks/webhooks.module";

@Module({
	imports: [WebhooksModule],
	controllers: [CompanyController],
	providers: [CompanyService, JwtService],
})
export class CompanyModule {}
