import { WebhookType } from "../../../../prisma/generated/prisma/client";

export interface WebhookDriver {
	supports(type: WebhookType): boolean;
	// biome-ignore lint/suspicious/noExplicitAny: Webhook payload shape varies by event type
	send(url: string, payload: any, secret?: string | null): Promise<boolean>;
}
