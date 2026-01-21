export interface VATRate {
  code: string; // 'S' = Standard, 'R1' = Réduit 1, 'Z' = Zéro, 'AE' = Autoliquidation
  rate: number;
  label: string; // Clé i18n, ex: "vat.standard"
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
  method: 'email' | 'peppol' | 'platform';
  labelKey: string;
  icon: string; // Nom d'icône (lucide)
  mandatory: boolean;
  platform?: string; // 'chorus', 'sdi', 'ksef', 'superpdp', etc.
}

export interface CountryConfig {
  code: string; // ISO 3166-1 alpha-2
  currency: string;
  isEU: boolean;

  vat: {
    rates: VATRate[];
    defaultRate: number;
    exemptions: VATExemption[];
    numberFormat: string;
    numberPrefix: string;
    reverseChargeTextKey: string;
  };

  identifiers: {
    company: CountryIdentifier[];
    client: CountryIdentifier[];
  };

  requiredFields: {
    invoice: string[];
    client: string[];
  };

  transmission: {
    b2b: TransmissionConfig;
    b2g: TransmissionConfig;
  };
}
