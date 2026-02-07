import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { SignaturesService } from "@/modules/signatures/signatures.service";

@Controller("signatures")
export class SignaturesController {
	constructor(private readonly signaturesService: SignaturesService) {}

	@Get("/:id")
	@AllowAnonymous()
	async getSignature(@Param("id") signatureId: string) {
		return (await this.signaturesService.getSignature(signatureId)) || {};
	}

	@Post("/")
	async createSignature(@Body("quoteId") quoteId: string) {
		return this.signaturesService.createSignature(quoteId);
	}

	@Post("/:id/otp")
	@AllowAnonymous()
	async generateOTPCode(@Param("id") signatureId: string) {
		return this.signaturesService.generateOTPCode(signatureId);
	}

	@Post("/:id/sign")
	@AllowAnonymous()
	async signQuote(
		@Param("id") signatureId: string,
		@Body("otpCode") otpCode: string,
	) {
		return this.signaturesService.signQuote(signatureId, otpCode);
	}
}
