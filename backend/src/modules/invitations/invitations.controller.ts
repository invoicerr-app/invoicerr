import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Query,
} from "@nestjs/common";
import { Public } from "@thallesp/nestjs-better-auth";
import { User } from "@/decorators/user.decorator";
import { pendingInvitationCodes } from "@/lib/auth";
import { CurrentUser } from "@/types/user";
import { InvitationsService } from "./invitations.service";

@Controller("invitations")
export class InvitationsController {
	constructor(private readonly invitationsService: InvitationsService) {}

	@Get("can-register")
	@Public()
	async canRegister(@Query("code") code?: string) {
		return this.invitationsService.canRegister(code);
	}

	@Get("is-first-user")
	@Public()
	async isFirstUser() {
		const isFirst = await this.invitationsService.isFirstUser();
		return { isFirstUser: isFirst };
	}

	@Post("validate")
	@Public()
	async validateInvitation(@Body() body: { code: string; email: string }) {
		if (!body.code || !body.email) {
			throw new BadRequestException("Code and email are required");
		}

		const result = await this.invitationsService.canRegister(body.code);

		if (!result.allowed) {
			throw new BadRequestException(
				result.message || "Invalid invitation code",
			);
		}

		pendingInvitationCodes.set(body.email.toLowerCase(), body.code);

		return { valid: true, message: "Invitation code validated" };
	}

	@Post()
	async createInvitation(
		@User() user: CurrentUser,
		@Body() body: { expiresInDays?: number },
	) {
		return this.invitationsService.createInvitation(
			user.id,
			body.expiresInDays,
		);
	}

	@Get()
	async listInvitations(@User() user: CurrentUser) {
		return this.invitationsService.listInvitations(user.id);
	}

	@Delete(":id")
	async deleteInvitation(@Param("id") id: string, @User() user: CurrentUser) {
		return this.invitationsService.deleteInvitation(id, user.id);
	}
}
