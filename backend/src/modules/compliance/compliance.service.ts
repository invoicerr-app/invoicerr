import { Injectable } from '@nestjs/common';
import { getAllCountryConfigs, getCountryConfig } from './configs';
import { CountrySummaryDto, FrontendComplianceConfigDto } from './dto/compliance-config.dto';
import { TransactionContext } from './interfaces';
import { ContextBuilderService } from './services/context-builder.service';
import { RuleResolverService } from './services/rule-resolver.service';
import { VATEngineService, VATCalculationInput, VATCalculationResult } from './services/vat-engine.service';
import { TransmissionService } from './transmission/transmission.service';
import { TransmissionPayload, TransmissionResult } from './transmission/transmission.interface';

@Injectable()
export class ComplianceService {
  constructor(
    private readonly contextBuilder: ContextBuilderService,
    private readonly ruleResolver: RuleResolverService,
    private readonly vatEngine: VATEngineService,
    private readonly transmissionService: TransmissionService,
  ) {}

  getConfig(countryCode: string) {
    return getCountryConfig(countryCode);
  }

  async buildContext(input: Parameters<ContextBuilderService['build']>[0]): Promise<TransactionContext> {
    return this.contextBuilder.build(input);
  }

  resolveRules(context: TransactionContext) {
    return this.ruleResolver.resolve(context);
  }

  calculateVAT(items: VATCalculationInput[], rules: Parameters<VATEngineService['calculate']>[1]): VATCalculationResult {
    return this.vatEngine.calculate(items, rules);
  }

  async sendInvoice(platform: string, payload: TransmissionPayload): Promise<TransmissionResult> {
    return this.transmissionService.send(platform, payload);
  }

  getConfigForFrontend(
    supplierCountry: string,
    customerCountry: string | null,
    transactionType: 'B2B' | 'B2G' | 'B2C',
  ): FrontendComplianceConfigDto {
    const supplierConfig = getCountryConfig(supplierCountry);
    const customerConfig = customerCountry ? getCountryConfig(customerCountry) : null;

    const isDomestic = supplierCountry === customerCountry;
    const isIntraEU = supplierConfig.isEU && !!customerConfig?.isEU && !isDomestic;
    const isExport = supplierConfig.isEU && !!customerConfig && !customerConfig.isEU;

    const context: TransactionContext = {
      supplier: {
        countryCode: supplierCountry,
        vatNumber: null,
        isVatRegistered: true,
      },
      customer: {
        countryCode: customerCountry,
        vatNumber: null,
        isVatRegistered: transactionType === 'B2B' && !!customerConfig?.isEU,
        isPublicEntity: transactionType === 'B2G',
      },
      transaction: {
        type: transactionType,
        isDomestic,
        isIntraEU,
        isExport,
      },
    };

    const rules = this.ruleResolver.resolve(context);

    return {
      vatRates: rules.vat.rates,
      defaultVatRate: rules.vat.defaultRate,
      reverseCharge: rules.vat.reverseCharge,
      reverseChargeTextKey: rules.vat.reverseChargeTextKey,
      requiredFields: rules.requiredFields,
      transmission: rules.transmission,
      legalMentionKeys: rules.legalMentionKeys,
      identifiers: supplierConfig.identifiers,
    };
  }

  getAvailableCountries(): CountrySummaryDto[] {
    return getAllCountryConfigs().map((c) => ({
      code: c.code,
      currency: c.currency,
      isEU: c.isEU,
    }));
  }
}
