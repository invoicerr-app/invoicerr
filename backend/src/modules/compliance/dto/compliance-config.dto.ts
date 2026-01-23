import {
  CountryIdentifier,
  CustomFieldDefinition,
  FormatRules,
  NumberingConfig,
  TransmissionRules,
  VATExemption,
  VATRate,
} from '../interfaces';

export interface FrontendComplianceConfigDto {
  // VAT
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

  // Document format
  format: FormatRules;

  // Transmission
  transmission: TransmissionRules;

  // Numbering
  numbering: NumberingConfig;

  // Legal mentions
  legalMentionKeys: string[];

  // Country identifiers
  identifiers: {
    company: CountryIdentifier[];
    client: CountryIdentifier[];
  };

  // Custom fields
  customFields: CustomFieldDefinition[];

  // Additional requirements
  qrCodeRequired: boolean;
  signatureRequired: boolean;
  hashChainRequired: boolean;

  // Correction codes
  correctionCodes: Array<{
    code: string;
    labelKey: string;
    ublTypeCode?: string;
  }>;
}

export interface CountrySummaryDto {
  code: string;
  name?: string;
  currency: string;
  isEU: boolean;
}

export interface TransmissionStatusDto {
  status: string;
  externalId?: string;
  message?: string;
}
