import crypto from "node:crypto";
import { WebhookType } from "../../../../prisma/generated/prisma/client";
import { WebhookDriver } from "./webhook-driver.interface";

export class GenericDriver implements WebhookDriver {
	supports(type: WebhookType) {
		return type === WebhookType.GENERIC;
	}

	async send(
		url: string,
		// biome-ignore lint/suspicious/noExplicitAny: WebhookDriver interface uses any
		payload: any,
		secret?: string | null,
	): Promise<boolean> {
		const body = JSON.stringify(payload);

		const signature = secret
			? crypto.createHmac("sha256", secret).update(body).digest("hex")
			: null;

		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(signature ? { "X-Webhook-Signature": signature } : {}),
			},
			body,
		});

		return res.ok;
	}
}
