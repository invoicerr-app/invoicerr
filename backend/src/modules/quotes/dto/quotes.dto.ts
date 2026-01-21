import type { Currency, ItemType } from '../../../../prisma/generated/prisma/client';

export class CreateQuoteDto {
  // number is auto generated
  title?: string;
  clientId: string;
  validUntil?: Date;
  currency?: Currency;
  paymentMethod?: string;
  paymentDetails?: string;
  paymentMethodId?: string;
  notes: string;
  items: {
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    type: ItemType;
    order: number;
  }[];
}

export class EditQuotesDto {
  id: string;
  title?: string;
  clientId: string;
  validUntil?: Date;
  currency?: Currency;
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
