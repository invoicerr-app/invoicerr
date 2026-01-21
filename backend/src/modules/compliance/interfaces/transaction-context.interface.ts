export interface TransactionContext {
  supplier: {
    countryCode: string; // ISO 3166-1 alpha-2
    vatNumber: string | null;
    isVatRegistered: boolean;
    identifiers: Record<string, string>; // { siret: "...", rcs: "...", etc. }
  };

  customer: {
    countryCode: string | null; // null = inconnu (B2C sans adresse)
    vatNumber: string | null;
    isVatRegistered: boolean;
    isPublicEntity: boolean; // B2G ?
    identifiers: Record<string, string>;
  };

  transaction: {
    type: 'B2B' | 'B2G' | 'B2C';
    nature: 'goods' | 'services' | 'mixed';
    isDomestic: boolean; // supplier.country === customer.country
    isIntraEU: boolean; // Both in EU, different countries
    isExport: boolean; // Outside EU
  };

  place: {
    delivery: string | null; // Delivery place (goods)
    performance: string | null; // Performance place (services)
    taxation: string; // Country where VAT is due (computed)
  };
}
