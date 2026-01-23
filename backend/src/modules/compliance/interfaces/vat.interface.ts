/**
 * VAT Rate definition
 */
export interface VATRate {
  /** Category code: 'S' = Standard, 'R1' = Reduced 1, 'R2' = Reduced 2, 'Z' = Zero, 'AE' = Reverse charge, 'G' = Export, 'E' = Exempt */
  code: string;
  /** Rate percentage (e.g., 20 for 20%) */
  rate: number;
  /** i18n label key */
  labelKey: string;
  /** UN/CEFACT category code for e-invoicing (S, Z, E, AE, K, G, O, L, M) */
  category?: string;
}

/**
 * VAT Exemption definition
 */
export interface VATExemption {
  /** Internal code */
  code: string;
  /** Legal article reference */
  article: string;
  /** i18n label key */
  labelKey: string;
  /** UBL TaxExemptionReasonCode */
  ublCode?: string;
}

/**
 * Complete VAT configuration for a country
 */
export interface VATConfig {
  /** Available VAT rates */
  rates: VATRate[];
  /** Default VAT rate percentage */
  defaultRate: number;
  /** Available exemptions */
  exemptions: VATExemption[];
  /** VAT number validation regex */
  numberFormat: string;
  /** VAT number prefix (e.g., 'FR', 'DE') */
  numberPrefix: string;
  /** Rounding mode: 'line' = per line then sum, 'total' = sum then round */
  roundingMode: 'line' | 'total';
  /** i18n keys for reverse charge texts */
  reverseChargeTexts: {
    /** For intra-EU services */
    services: string;
    /** For intra-EU goods */
    goods: string;
  };
}
