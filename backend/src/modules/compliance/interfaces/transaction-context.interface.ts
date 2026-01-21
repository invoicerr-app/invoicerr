export interface TransactionContext {
  supplier: {
    countryCode: string;
    vatNumber: string | null;
    isVatRegistered: boolean;
  };

  customer: {
    countryCode: string | null;
    vatNumber: string | null;
    isVatRegistered: boolean;
    isPublicEntity: boolean;
  };

  transaction: {
    type: 'B2B' | 'B2G' | 'B2C';
    isDomestic: boolean;
    isIntraEU: boolean;
    isExport: boolean;
  };
}
