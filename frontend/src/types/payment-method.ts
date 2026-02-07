import { Company } from "./company";

export enum PaymentMethodType {
  BANK_TRANSFER = 'BANK_TRANSFER',
  PAYPAL = 'PAYPAL',
  CASH = 'CASH',
  CHECK = 'CHECK',
  OTHER = 'OTHER',
}

export interface PaymentMethod {
  id: string;
  companyId: string;
  company?: Company;
  name: string;
  details?: string; // Use this to store IBAN or other textual details
  type: PaymentMethodType;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}