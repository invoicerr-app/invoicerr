import { Injectable } from "@nestjs/common";

import { WebhookEvent } from "../../../prisma/generated/prisma/client";
import { WebhooksService } from "./webhooks.service";
import prisma from '@/prisma/prisma.service';
import { logger } from "@/logger/logger.service";

@Injectable()
export class WebhookDispatcherService {
    constructor(private readonly webhookService: WebhooksService) { }

    async dispatch(event: WebhookEvent, payload: any) {
            const companyId = payload?.company?.id || payload?.companyId || null;

            const where: any = { events: { has: event } };
            if (companyId) where.companyId = companyId;

            const webhooks = await prisma.webhook.findMany({ where });

        try {
            await this.webhookService.send(webhooks, event, payload);
            logger.info('Webhook dispatched', { category: 'webhook-dispatcher', details: { event, webhooks } });
        } catch (error) {
            logger.error('Error dispatching webhook', { category: 'webhook-dispatcher', details: { error, event, webhooks } });
            throw error;
        }
    }
}
