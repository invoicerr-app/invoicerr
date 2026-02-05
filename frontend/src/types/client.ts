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
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country?: string;
  currency?: string;
  isActive?: boolean;
}
