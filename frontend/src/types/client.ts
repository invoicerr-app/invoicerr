export interface Client {
  id: string;
  name: string;
  description?: string;
  identifiers: Record<string, string>;
  type: 'COMPANY' | 'INDIVIDUAL';
  foundedAt?: Date;
  contactFirstname?: string;
  contactLastname?: string;
  contactEmail: string;
  contactPhone?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  currency?: string;
  isActive?: boolean;
}
