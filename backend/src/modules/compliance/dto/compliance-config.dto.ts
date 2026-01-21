import { CountryIdentifier, TransmissionConfig, VATRate } from '../interfaces';

export interface FrontendComplianceConfigDto {
  vatRates: VATRate[];
  defaultVatRate: number;
  reverseCharge: boolean;
  reverseChargeTextKey: string | null;

  requiredFields: {
    invoice: string[];
    client: string[];
  };

  transmission: TransmissionConfig;

  legalMentionKeys: string[];

  identifiers: {
    company: CountryIdentifier[];
    client: CountryIdentifier[];
  };
}

export interface CountrySummaryDto {
  code: string;
  currency: string;
  isEU: boolean;
}
