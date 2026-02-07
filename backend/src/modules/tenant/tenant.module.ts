import { Module, Scope } from "@nestjs/common";
import { TenantService, TenantContext } from "./tenant.service";

@Module({
	providers: [
		TenantService,
		{
			provide: TenantContext,
			useClass: TenantContext,
			scope: Scope.REQUEST,
		},
	],
	exports: [TenantService, TenantContext],
})
export class TenantModule {}
