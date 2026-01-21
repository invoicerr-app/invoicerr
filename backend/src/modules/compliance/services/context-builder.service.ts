import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../interfaces';
import { getCountryConfig } from '../configs';
import { VIESService } from './vies.service';

export interface ContextBuildInput {
  company: {
    countryCode: string;
    VAT: string | null;
    exemptVat: boolean;
  };
  client: {
    countryCode: string | null;
    VAT: string | null;
    type: 'COMPANY' | 'INDIVIDUAL';
    isPublicEntity?: boolean;
  };
}

@Injectable()
export class ContextBuilderService {
  constructor(private readonly viesService: VIESService) {}

  async build(input: ContextBuildInput): Promise<TransactionContext> {
    const { company, client } = input;

    const supplierConfig = getCountryConfig(company.countryCode);
    const customerConfig = client.countryCode ? getCountryConfig(client.countryCode) : null;

    // Validate customer VAT if intra-EU
    let customerVatValid = false;
    if (client.VAT && customerConfig?.isEU && supplierConfig.isEU) {
      customerVatValid = await this.viesService.validate(client.VAT);
    }

    const isDomestic = company.countryCode === client.countryCode;
    const isIntraEU = supplierConfig.isEU && !!customerConfig?.isEU && !isDomestic;
    const isExport = supplierConfig.isEU && !!customerConfig && !customerConfig.isEU;

    return {
      supplier: {
        countryCode: company.countryCode,
        vatNumber: company.VAT,
        isVatRegistered: !!company.VAT && !company.exemptVat,
      },
      customer: {
        countryCode: client.countryCode,
        vatNumber: client.VAT,
        isVatRegistered: customerVatValid,
        isPublicEntity: client.isPublicEntity || false,
      },
      transaction: {
        type: this.resolveType(client),
        isDomestic,
        isIntraEU,
        isExport,
      },
    };
  }

  private resolveType(client: ContextBuildInput['client']): 'B2B' | 'B2G' | 'B2C' {
    if (client.isPublicEntity) return 'B2G';
    if (client.type === 'COMPANY') return 'B2B';
    return 'B2C';
  }
}
