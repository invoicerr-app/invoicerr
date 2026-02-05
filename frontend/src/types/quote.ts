import type { Client } from './client';
import type { Company } from './company';
import type { PaymentMethod } from './payment-method';

export enum QuoteStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  VIEWED = 'VIEWED',
  SIGNED = 'SIGNED',
  EXPIRED = 'EXPIRED',
}

export interface Quote {
  id: string;
  number: number;
  rawNumber?: string;
  title?: string;
  clientId: string;
  client: Client;
  companyId: string;
  company: Company;
  items: QuoteItem[];
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
  validUntil?: string;
  signedAt?: string;
  signatureSvg?: string;
  notes?: string;
  totalHT: number;
  totalVAT: number;
  totalTTC: number;
  currency: string;
  paymentMethodId?: string;
  paymentMethod?: PaymentMethod;
  isActive: boolean;
}

export enum QuoteItemType {
  HOUR = 'HOUR',
  DAY = 'DAY',
  DEPOSIT = 'DEPOSIT',
  SERVICE = 'SERVICE',
  PRODUCT = 'PRODUCT',
}

export interface QuoteItem {
  id: string;
  quoteId: string;
  type: QuoteItemType;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number; // 20 for 20%
  order: number; // For sorting items in the quote PDF
}
