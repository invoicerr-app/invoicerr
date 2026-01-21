export interface Client {
  id: string;
  name: string;
  description?: string;
  legalId?: string;
  VAT?: string;
  type: string;
  foundedAt?: Date;
  contactFirstname?: string;
  contactLastname?: string;
  contactEmail: string;
  contactPhone?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  currency?: string; // Assuming currency is a string, e.g., "USD", "EUR"
  isActive?: boolean;
}
