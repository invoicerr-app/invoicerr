import { Module } from "@nestjs/common";
import { PrismaModule } from "@/prisma/prisma.module";
import { InvitationsController } from "./invitations.controller";
import { InvitationsService } from "./invitations.service";
import { CompanyMembershipModule } from "@/modules/company-membership/company-membership.module";

@Module({
	imports: [PrismaModule, CompanyMembershipModule],
	controllers: [InvitationsController],
	providers: [InvitationsService],
	exports: [InvitationsService],
})
export class InvitationsModule {}
