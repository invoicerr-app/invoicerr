import {
	type WebhookEvent,
	WebhookType,
} from "../../../../prisma/generated/prisma/client";
import { EVENT_STYLES, formatPayloadForEvent } from "./event-formatters";

import { WebhookDriver } from "./webhook-driver.interface";

export interface TeamsField {
	name: string;
	value: string;
}

interface AdaptiveCardElement {
	type: string;
	text?: string;
	weight?: string;
	size?: string;
	color?: string;
	spacing?: string;
	style?: string;
	items?: AdaptiveCardElement[];
	facts?: Array<{ name: string; value: string }>;
}

interface AdaptiveCardData {
	$schema: string;
	type: string;
	version: string;
	body: AdaptiveCardElement[];
}

export class TeamsAdaptiveCard {
	private data: AdaptiveCardData = {
		$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
		type: "AdaptiveCard",
		version: "1.2",
		body: [],
	};

	addTextBlock(
		text: string,
		weight?: "default" | "lighter" | "normal" | "bolder",
	): this {
		this.data.body.push({
			type: "TextBlock",
			text,
			weight: weight || "default",
		});
		return this;
	}

	setTitle(title: string, color?: string): this {
		this.data.body.unshift({
			type: "TextBlock",
			text: title,
			weight: "bolder",
			size: "large",
			color: color || "accent", // 'accent', 'good', 'warning', 'attention'
		});
		return this;
	}

	addFactSet(facts: Array<{ name: string; value: string }>): this {
		this.data.body.push({
			type: "FactSet",
			facts: facts.map((f) => ({ name: `${f.name}:`, value: f.value })),
		});
		return this;
	}

	setFooter(text: string): this {
		this.data.body.push({
			type: "TextBlock",
			text,
			size: "small",
			weight: "lighter",
			color: "light",
			spacing: "large",
		});
		return this;
	}

	setAccentColor(color: "accent" | "good" | "warning" | "attention"): this {
		this.data.body.unshift({
			type: "Container",
			style: color,
			items: [],
		});
		return this;
	}

	build(): AdaptiveCardData {
		return this.data;
	}
}

export class TeamsWebhook {
	private webhook: string;
	private card: TeamsAdaptiveCard | null = null;
	private text: string = "";

	constructor(webhookUrl: string) {
		this.webhook = webhookUrl;
	}

	setText(text: string): this {
		this.text = text;
		return this;
	}

	setCard(card: TeamsAdaptiveCard): this {
		this.card = card;
		return this;
	}

	async send(): Promise<Response> {
		const payload: {
			type: string;
			attachments: Array<{
				contentType: string;
				content: AdaptiveCardData | Record<string, unknown>;
			}>;
		} = {
			type: "message",
			attachments: [],
		};

		if (this.card) {
			payload.attachments.push({
				contentType: "application/vnd.microsoft.card.adaptive",
				content: this.card.build(),
			});
		} else if (this.text) {
			payload.attachments.push({
				contentType: "application/vnd.microsoft.card.adaptive",
				content: {
					$schema: "http://adaptivecards.io/schemas/adaptive-card.json",
					type: "AdaptiveCard",
					version: "1.2",
					body: [
						{
							type: "TextBlock",
							text: this.text,
						},
					],
				},
			});
		}

		const response = await fetch(this.webhook, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		this.text = "";
		this.card = null;

		return response;
	}
}

export class TeamsDriver implements WebhookDriver {
	supports(type: WebhookType) {
		return type === WebhookType.TEAMS;
	}

	// biome-ignore lint/suspicious/noExplicitAny: WebhookDriver interface uses any
	async send(url: string, payload: any): Promise<boolean> {
		const hook = new TeamsWebhook(url);

		const eventType = payload.event as WebhookEvent;
		const eventStyle = EVENT_STYLES[eventType] || {
			color: "accent",
			emoji: "📢",
			title: "Event",
		};

		const description = formatPayloadForEvent(eventType, payload);

		const card = new TeamsAdaptiveCard()
			.setTitle(`${eventStyle.emoji} ${eventStyle.title}`, eventStyle.color)
			.addTextBlock(description)
			.setFooter(`Invoicerr Webhooks • ${new Date().toLocaleString()}`);

		if (payload.company?.name) {
			card.addFactSet([{ name: "Entreprise", value: payload.company.name }]);
		}

		const res = await hook.setCard(card).send();

		return res.ok;
	}
}
