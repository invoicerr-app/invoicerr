import type { NumberingConfig, VATExemption, VATRate } from './country-config.interface';

export interface VATRules {
  rates: VATRate[];
  exemptions: VATExemption[];
  defaultRate: number;
  reverseCharge: boolean;
  reverseChargeTextKey: string | null;
}

export interface ValidationRules {
  requiredFields: {
    invoice: string[];
    client: string[];
  };
  identifierFormats: Record<string, string>; // { siret: '^[0-9]{14}$', ... }
  vatNumberFormat: string | null;
}

export interface FormatRules {
  preferred: string; // 'facturx', 'fatturaPA', 'ubl', etc.
  supported: string[];
  xmlSyntax: 'UBL' | 'CII' | 'FatturaPA' | 'KSeF';
}

export interface TransmissionRules {
  method: 'email' | 'peppol' | 'clearance' | 'platform';
  mandatory: boolean;
  platform: string | null;
  async: boolean;
  deadlineDays: number | null;
  labelKey: string;
  icon: string;
}

export interface ApplicableRules {
  vat: VATRules;
  validation: ValidationRules;
  format: FormatRules;
  transmission: TransmissionRules;
  numbering: NumberingConfig;
  legalMentionKeys: string[];
}
