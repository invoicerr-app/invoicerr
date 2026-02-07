import {
	Currency,
	ItemType,
} from "../../../../prisma/generated/prisma/client";

export class CreateInvoiceDto {
	clientId: string;
	quoteId?: string;
	dueDate?: Date;
	currency?: Currency;
	notes: string;
	paymentMethod?: string;
	paymentDetails?: string;
	paymentMethodId?: string;
	items: {
		description: string;
		quantity: number;
		unitPrice: number;
		vatRate: number;
		type: ItemType;
		order: number;
	}[];
}

export class EditInvoicesDto {
	id: string;
	quoteId?: string;
	clientId: string;
	dueDate?: Date;
	currency?: Currency;
	notes: string;
	paymentMethod?: string;
	paymentDetails?: string;
	paymentMethodId?: string;
	items: {
		id?: string; // Optional for new items
		description: string;
		quantity: number;
		unitPrice: number;
		vatRate: number;
		type: ItemType;
		order: number;
	}[];
}
