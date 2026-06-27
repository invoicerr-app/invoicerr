export type IdentifierScheme = 'LEGAL_ID' | 'VAT' | 'RFC';

export interface Scenario {
  id: string;
  company: {
    name: string;
    country: string;
    legalId: string;
    currency: string;
    identifierScheme?: IdentifierScheme;
  };
  client: {
    name: string;
    email: string;
    country: string;
    type: 'COMPANY' | 'INDIVIDUAL';
    vat?: string;
    address: string;
    postalCode: string;
    city: string;
    currency: string;
    contactFirstname?: string;
    contactLastname?: string;
  };
  item: {
    name: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    type: 'SERVICE' | 'PRODUCT' | 'HOUR' | 'DAY';
  };
}

export const SCENARIOS: Record<string, Scenario> = {
  'fr-be': {
    id: 'fr-be',
    company: { name: 'Studio Lyon SARL', country: 'France', legalId: '73282932000074', currency: 'EUR', identifierScheme: 'LEGAL_ID' },
    client: { name: 'Brussels Retail NV', email: 'client-fr-be@mailpit.test', country: 'Belgium', type: 'COMPANY', vat: 'BE0123456789', address: '10 Rue de la Loi', postalCode: '1000', city: 'Brussels', currency: 'EUR' },
    item: { name: 'Consulting', quantity: 5, unitPrice: 200, vatRate: 21, type: 'SERVICE' },
  },
  'de-fr': {
    id: 'de-fr',
    company: { name: 'Berlin Tech GmbH', country: 'Germany', legalId: 'DE123456789', currency: 'EUR' },
    client: { name: 'Paris Media SAS', email: 'client-de-fr@mailpit.test', country: 'France', type: 'COMPANY', vat: 'FR12345678901', address: '15 Rue de Rivoli', postalCode: '75001', city: 'Paris', currency: 'EUR' },
    item: { name: 'Software License', quantity: 1, unitPrice: 1200, vatRate: 20, type: 'PRODUCT' },
  },
  'it-it': {
    id: 'it-it',
    company: { name: 'Milano Servizi SRL', country: 'Italy', legalId: '12345678901', currency: 'EUR', identifierScheme: 'VAT' },
    client: { name: 'Comune di Roma', email: 'client-it-it@mailpit.test', country: 'Italy', type: 'COMPANY', vat: 'IT98765432109', address: 'Via del Corso', postalCode: '00186', city: 'Rome', currency: 'EUR' },
    item: { name: 'Servizi IT', quantity: 10, unitPrice: 90, vatRate: 22, type: 'SERVICE' },
  },
  'es-pt': {
    id: 'es-pt',
    company: { name: 'Madrid Diseño SL', country: 'Spain', legalId: 'ESB12345678', currency: 'EUR' },
    client: { name: 'Lisboa Comércio Lda', email: 'client-es-pt@mailpit.test', country: 'Portugal', type: 'COMPANY', vat: 'PT123456789', address: 'Av. da Liberdade', postalCode: '1250-143', city: 'Lisbon', currency: 'EUR' },
    item: { name: 'Diseño web', quantity: 3, unitPrice: 500, vatRate: 21, type: 'SERVICE' },
  },
  'mx-us': {
    id: 'mx-us',
    company: { name: 'CDMX Soluciones SA', country: 'Mexico', legalId: 'MEX010101AAA', currency: 'MXN', identifierScheme: 'RFC' },
    client: { name: 'Austin Imports LLC', email: 'client-mx-us@mailpit.test', country: 'United States', type: 'COMPANY', address: '100 Congress Ave', postalCode: '78701', city: 'Austin', currency: 'USD' },
    item: { name: 'Productos', quantity: 20, unitPrice: 35, vatRate: 16, type: 'PRODUCT' },
  },
  'us-us': {
    id: 'us-us',
    company: { name: 'Denver Goods Inc', country: 'United States', legalId: '12-3456789', currency: 'USD' },
    client: { name: 'Jane Customer', email: 'client-us-us@mailpit.test', country: 'United States', type: 'INDIVIDUAL', contactFirstname: 'Jane', contactLastname: 'Customer', address: '123 Main St', postalCode: '80202', city: 'Denver', currency: 'USD' },
    item: { name: 'Widget', quantity: 2, unitPrice: 150, vatRate: 0, type: 'PRODUCT' },
  },
};
