import type { Company } from "./company";

export enum ArticleType {
  HOUR = "HOUR",
  DAY = "DAY",
  DEPOSIT = "DEPOSIT",
  SERVICE = "SERVICE",
  PRODUCT = "PRODUCT",
}

export interface Article {
  id: string;
  companyId: string;
  company?: Company;
  name: string;
  description?: string | null;
  type: ArticleType;
  unitPrice: number;
  vatRate: number;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}
