export interface VATRate {
  code: string; // 'S' = Standard, 'R1' = Reduced 1, 'Z' = Zero, 'AE' = Reverse charge, 'G' = Export
  rate: number;
  label: string; // i18n key
}

export interface VATExemption {
  code: string;
  article: string;
  labelKey: string;
}

export interface CountryIdentifier {
  id: string; // 'siret', 'siren', 'nif', etc.
  labelKey: string;
  format: string; // Regex as string
  required: boolean;
}

export interface TransmissionConfig {
  method: 'email' | 'peppol' | 'clearance' | 'platform';
  labelKey: string;
  icon: string;
  mandatory: boolean;
  mandatoryFrom?: string; // Date ISO string
  platform?: string; // 'chorus', 'sdi', 'ksef', 'superpdp', etc.
  async: boolean;
  deadlineDays?: number;
}

export interface NumberingConfig {
  seriesRequired: boolean;
  seriesRegistration: boolean; // Portugal: enregistrement AT
  hashChaining: boolean; // Espagne, Portugal
  gapAllowed: boolean;
  resetPeriod: 'never' | 'yearly' | 'monthly';
}

export interface PeppolConfig {
  enabled: boolean;
  schemeId: string;
  participantIdPrefix: string;
}

export interface CountryConfig {
  code: string; // ISO 3166-1 alpha-2
  currency: string;
  isEU: boolean;

  vat: {
    rates: VATRate[];
    defaultRate: number;
    exemptions: VATExemption[];
    numberFormat: string; // Regex pour validation
    numberPrefix: string; // 'FR', 'DE', etc.
    roundingMode: 'line' | 'total'; // Per-line or per-total rounding
    reverseChargeTexts: {
      services: string; // i18n key for services reverse charge
      goods: string; // i18n key for goods reverse charge
    };
  };

  identifiers: {
    company: CountryIdentifier[];
    client: CountryIdentifier[];
  };

  requiredFields: {
    invoice: string[];
    client: string[];
  };

  documentFormat: {
    preferred: string; // 'facturx', 'fatturaPA', 'ubl', etc.
    supported: string[];
    xmlSyntax: 'UBL' | 'CII' | 'FatturaPA' | 'KSeF';
  };

  transmission: {
    b2b: TransmissionConfig;
    b2g: TransmissionConfig;
  };

  numbering: NumberingConfig;

  peppol?: PeppolConfig;

  legalMentions: {
    mandatory: string[]; // i18n keys
    conditional: Array<{
      condition: string;
      textKey: string;
    }>;
  };
}
