import { Controller, Get, Query } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { ComplianceService } from './compliance.service';

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get('config')
  @AllowAnonymous()
  getConfig(
    @Query('supplierCountry') supplierCountry: string,
    @Query('customerCountry') customerCountry?: string,
    @Query('transactionType') transactionType?: 'B2B' | 'B2G' | 'B2C',
  ) {
    return this.complianceService.getConfigForFrontend(
      supplierCountry || 'FR',
      customerCountry || null,
      transactionType || 'B2B',
    );
  }

  @Get('countries')
  @AllowAnonymous()
  getAvailableCountries() {
    return this.complianceService.getAvailableCountries();
  }
}
