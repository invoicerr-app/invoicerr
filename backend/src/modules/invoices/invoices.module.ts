import { InvoicesController } from "@/modules/invoices/invoices.controller";
import { InvoicesService } from "@/modules/invoices/invoices.service";
import { JwtService } from "@nestjs/jwt";
import { Module } from "@nestjs/common";
import { PluginsService } from "@/modules/plugins/plugins.service";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { ComplianceModule } from "@/compliance/nest/compliance.module";
import { NumberingService } from "@/utils/numbering";
import { InvoiceRenderingModule } from "@/modules/invoice-rendering/invoice-rendering.module";

@Module({
  imports: [WebhooksModule, ComplianceModule, InvoiceRenderingModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, JwtService, PluginsService, NumberingService],
  exports: [InvoicesService],
})
export class InvoicesModule { }
