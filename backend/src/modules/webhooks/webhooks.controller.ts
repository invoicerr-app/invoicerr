import {
	Body,
	Controller,
	Delete,
	Get,
	HttpException,
	HttpStatus,
	Logger,
	Param,
	Patch,
	Post,
	Req,
	Res,
	UseGuards,
} from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { Request, Response } from "express";
import { AuthGuard } from "@/guards/auth.guard";
import prisma from "@/prisma/prisma.service";
import {
	WebhookEvent,
	WebhookType,
} from "../../../prisma/generated/prisma/client";
import { WebhookDispatcherService } from "./webhook-dispatcher.service";
import { WebhooksService } from "./webhooks.service";

interface CreateWebhookDto {
	url: string;
	type?: WebhookType;
	events?: WebhookEvent[];
	secret?: string;
}

interface UpdateWebhookDto {
	url?: string;
	type?: WebhookType;
	events?: WebhookEvent[];
	secret?: string;
}

@Controller("webhooks")
export class WebhooksController {
	private readonly logger = new Logger(WebhooksController.name);

	constructor(
		private readonly webhooksService: WebhooksService,
		private readonly webhookDispatcher: WebhookDispatcherService,
	) {}

	@Get("options")
	@UseGuards(AuthGuard)
	async options() {
		const types = Object.values(WebhookType);
		const events = Object.values(WebhookEvent);

		return { types, events };
	}

	@Get(":id")
	@UseGuards(AuthGuard)
	async findOne(@Param("id") id: string) {
		const wh = await prisma.webhook.findUnique({ where: { id } });
		if (!wh) throw new HttpException("Webhook not found", HttpStatus.NOT_FOUND);

		const company = await prisma.company.findFirst();
		if (!company || wh.companyId !== company.id)
			throw new HttpException("Webhook not found", HttpStatus.NOT_FOUND);

		return { ...wh, secret: undefined };
	}

	@Post(":uuid")
	@AllowAnonymous()
	async handleWebhook(
		@Param("uuid") uuid: string,
		@Body() body: unknown,
		@Req() req: Request,
		@Res() res: Response,
	) {
		try {
			const result = await this.webhooksService.handlePluginWebhook(
				uuid,
				body,
				req,
			);

			return res.status(200).json({
				success: true,
				message: "Webhook processed successfully",
				data: result,
			});
		} catch (error) {
			this.logger.error(`Error processing webhook for plugin ${uuid}:`, error);

			return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
				success: false,
				message: "Webhook processing failed",
				error: error.message,
			});
		}
	}

	// Protected CRUD endpoints for managing webhooks (company-scoped)
	@Get()
	@UseGuards(AuthGuard)
	async list() {
		const company = await prisma.company.findFirst();
		if (!company) return [];

		const webhooks = await prisma.webhook.findMany({
			where: { companyId: company.id },
		});

		// Remove secret from response
		return webhooks.map((w) => ({ ...w, secret: undefined }));
	}

	@Post()
	@UseGuards(AuthGuard)
	async create(@Body() body: CreateWebhookDto) {
		const company = await prisma.company.findFirst();
		if (!company)
			throw new HttpException("No company found", HttpStatus.BAD_REQUEST);

		const secret = body.secret ?? "";

		const created = await prisma.webhook.create({
			data: {
				url: body.url,
				type: body.type ?? "GENERIC",
				events: body.events ?? [],
				secret,
				companyId: company.id,
			},
		});

		try {
			await this.webhookDispatcher.dispatch(WebhookEvent.WEBHOOK_CREATED, {
				webhook: created,
				company,
			});
		} catch (err) {
			this.logger.error("Failed to dispatch WEBHOOK_CREATED", err);
		}

		// Return the secret only once
		return { success: true, data: { ...created, secret } };
	}

	@Patch(":id")
	@UseGuards(AuthGuard)
	async update(@Param("id") id: string, @Body() body: UpdateWebhookDto) {
		const existing = await prisma.webhook.findUnique({ where: { id } });
		if (!existing)
			throw new HttpException("Webhook not found", HttpStatus.NOT_FOUND);

		const company = await prisma.company.findFirst();
		if (!company || existing.companyId !== company.id)
			throw new HttpException("Webhook not found", HttpStatus.NOT_FOUND);

		const updated = await prisma.webhook.update({
			where: { id },
			data: {
				url: body.url ?? existing.url,
				type: body.type ?? existing.type,
				events: body.events ?? existing.events,
				secret: body.secret ?? existing.secret,
			},
		});

		try {
			await this.webhookDispatcher.dispatch(WebhookEvent.WEBHOOK_UPDATED, {
				webhook: updated,
				company,
			});
		} catch (err) {
			this.logger.error("Failed to dispatch WEBHOOK_UPDATED", err);
		}

		return { success: true, data: { ...updated, secret: undefined } };
	}

	@Delete(":id")
	@UseGuards(AuthGuard)
	async remove(@Param("id") id: string) {
		const existing = await prisma.webhook.findUnique({ where: { id } });
		if (!existing)
			throw new HttpException("Webhook not found", HttpStatus.NOT_FOUND);

		const company = await prisma.company.findFirst();
		if (!company || existing.companyId !== company.id)
			throw new HttpException("Webhook not found", HttpStatus.NOT_FOUND);

		await prisma.webhook.delete({ where: { id } });

		try {
			await this.webhookDispatcher.dispatch(WebhookEvent.WEBHOOK_DELETED, {
				webhook: existing,
				company,
			});
		} catch (err) {
			this.logger.error("Failed to dispatch WEBHOOK_DELETED", err);
		}

		return { success: true };
	}
}
