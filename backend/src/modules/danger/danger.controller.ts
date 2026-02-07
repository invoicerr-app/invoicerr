import { BadRequestException, Body, Controller, Post, UseGuards } from "@nestjs/common";
import { User } from "@/decorators/user.decorator";
import { Company } from "@/decorators/company.decorator";
import { DangerService } from "@/modules/danger/danger.service";
import { CurrentUser } from "@/types/user";
import { AuthGuard } from "@/guards/auth.guard";
import { TenantGuard } from "@/guards/tenant.guard";

@Controller("danger")
@UseGuards(AuthGuard, TenantGuard)
export class DangerController {
	constructor(private readonly dangerService: DangerService) {}

	@Post("otp")
	async requestOtp(@User() user: CurrentUser, @Company() companyId: string | null) {
		return this.dangerService.requestOtp(user, companyId);
	}

	@Post("reset/app")
	async resetApp(
		@User() user: CurrentUser,
		@Company() companyId: string | null,
		@Body() body: { otp: string },
	) {
		const { otp } = body;
		if (!otp) {
			throw new BadRequestException("OTP is required for this action");
		}
		return this.dangerService.resetApp(user, companyId, otp);
	}

	@Post("reset/all")
	async resetAll(
		@User() user: CurrentUser,
		@Company() companyId: string | null,
		@Body() body: { otp: string },
	) {
		const { otp } = body;
		if (!otp) {
			throw new BadRequestException("OTP is required for this action");
		}
		return this.dangerService.resetAll(user, companyId, otp);
	}
}
