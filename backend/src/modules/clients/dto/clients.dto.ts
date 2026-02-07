import {
	ClientType,
	Currency,
} from "../../../../prisma/generated/prisma/client";

export class EditClientsDto {
	description?: string;
	legalId?: string;
	VAT?: string;
	foundedAt?: Date;
	id: string;
	name: string;
	contactFirstname?: string;
	contactLastname?: string;
	contactEmail?: string;
	contactPhone?: string;
	address: string;
	addressLine2?: string;
	postalCode: string;
	city: string;
	state?: string;
	country: string;
	currency: Currency;
	type?: ClientType;
	isActive: boolean;
}
