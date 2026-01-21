import { TransmissionConfig, VATRate } from './country-config.interface';

export interface ApplicableRules {
  vat: {
    rates: VATRate[];
    defaultRate: number;
    reverseCharge: boolean;
    reverseChargeTextKey: string | null;
  };

  requiredFields: {
    invoice: string[];
    client: string[];
  };

  transmission: TransmissionConfig;

  legalMentionKeys: string[];
}
