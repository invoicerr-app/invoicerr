import type {
  CountryIdentifier,
  FormatRules,
  NumberingConfig,
  TransmissionRules,
  VATExemption,
  VATRate,
} from '../interfaces';

export interface FrontendComplianceConfigDto {
  // TVA
  vatRates: VATRate[];
  defaultVatRate: number;
  reverseCharge: boolean;
  reverseChargeTextKey: string | null;
  exemptions: VATExemption[];

  // Validation
  requiredFields: {
    invoice: string[];
    client: string[];
  };
  identifierFormats: Record<string, string>;
  vatNumberFormat: string | null;

  // Format de document
  format: FormatRules;

  // Transmission
  transmission: TransmissionRules;

  // Numbering
  numbering: NumberingConfig;

  // Legal mentions
  legalMentionKeys: string[];

  // Identifiants pays
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
