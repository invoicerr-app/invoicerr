export class UpsertInvoicesDto {
	quoteId?: string;
	clientId: string;
	notes?: string;
	paymentMethod?: string;
	paymentDetails?: string;
	paymentMethodId?: string;
	frequency:
		| "WEEKLY"
		| "BIWEEKLY"
		| "MONTHLY"
		| "BIMONTHLY"
		| "QUARTERLY"
		| "QUADMONTHLY"
		| "SEMIANNUALLY"
		| "ANNUALLY";
	count?: number;
	until?: Date;
	autoSend?: boolean;
	currency?: string;
	items: {
		id?: string;
		description: string;
		quantity: number;
		unitPrice: number;
		vatRate: number;
		type?: "HOUR" | "DAY" | "DEPOSIT" | "SERVICE" | "PRODUCT";
		order: number;
	}[];
}
