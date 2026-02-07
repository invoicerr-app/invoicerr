import { Injectable } from "@nestjs/common";
import { logger } from "@/logger/logger.service";
import prisma from "@/prisma/prisma.service";
import { WebhookEvent } from "../../../prisma/generated/prisma/client";
import { WebhooksService } from "./webhooks.service";

@Injectable()
export class WebhookDispatcherService {
	constructor(private readonly webhookService: WebhooksService) {}

	// biome-ignore lint/suspicious/noExplicitAny: Payload shape varies by webhook event type
	async dispatch(event: WebhookEvent, payload: any) {
		const companyId = payload?.company?.id || payload?.companyId || null;

		// biome-ignore lint/suspicious/noExplicitAny: Prisma where type is complex
		const where: any = { events: { has: event } };
		if (companyId) where.companyId = companyId;

		const webhooks = await prisma.webhook.findMany({ where });

		try {
			await this.webhookService.send(webhooks, event, payload);
			logger.info("Webhook dispatched", {
				category: "webhook-dispatcher",
				details: { event, webhooks },
			});
		} catch (error) {
			logger.error("Error dispatching webhook", {
				category: "webhook-dispatcher",
				details: { error, event, webhooks },
			});
			throw error;
		}
	}
}
