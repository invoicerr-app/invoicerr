import type { ClientType, Currency } from '../../../../prisma/generated/prisma/client';

export class EditClientsDto {
  description?: string;
  identifiers?: Record<string, string>; // Dynamic identifiers based on country (e.g., { siret: "...", vat: "..." })
  foundedAt?: Date;
  id: string;
  name: string;
  contactFirstname?: string;
  contactLastname?: string;
  contactEmail?: string;
  contactPhone?: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  currency: Currency;
  type?: ClientType;
  isActive: boolean;
}
