import { Module } from "@nestjs/common";
import { CompanyMembershipService } from "./company-membership.service";

@Module({
	providers: [CompanyMembershipService],
	exports: [CompanyMembershipService],
})
export class CompanyMembershipModule {}
