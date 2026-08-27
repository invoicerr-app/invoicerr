import { EVENT_STYLES, formatPayloadForEvent } from "./event-formatters";
import { Embed, Webhook } from "@teever/ez-hook";
import { WebhookEvent, WebhookType } from "../../../../prisma/generated/prisma/client";

import { WebhookDriver } from "./webhook-driver.interface";

export class DiscordDriver implements WebhookDriver {
    supports(type: WebhookType) {
        return type === WebhookType.DISCORD;
    }

    async send(url: string, payload: any): Promise<boolean> {
        const hook = new Webhook(url);
        const instanceUrl = process.env.APP_URL || 'https://invoicerr.app';

        hook.setUsername('Invoicerr').setAvatarUrl('https://invoicerr.app/favicon.svg');

        const eventType = payload.event as WebhookEvent;
        const eventStyle = EVENT_STYLES[eventType] || {
            color: "#5865F2",
            emoji: "📢",
            title: "Event"
        };

        const description = formatPayloadForEvent(eventType, payload);

        const embed = new Embed()
            .setTitle(`${eventStyle.emoji} ${eventStyle.title}`)
            .setDescription(description)
            .setTimestamp()
            .setColor(eventStyle.color)
            .setAuthor({
                name: 'Invoicerr',
                url: instanceUrl,
                icon_url: 'https://invoicerr.app/favicon.svg',
            })
            .setFooter({
                text: 'Invoicerr Webhooks',
                icon_url: 'https://invoicerr.app/favicon.svg',
            });

        if (payload.company?.name) {
            embed.addField('Entreprise', payload.company.name, true);
        }

        const res = await hook.addEmbed(embed).send();
        return res.ok;
    }
}
