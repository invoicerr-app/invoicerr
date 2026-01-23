import { Controller, Get, Query } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { ComplianceService } from './compliance.service';

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  /**
   * Get compliance configuration for frontend
   * Used to dynamically configure forms based on supplier/customer countries
   */
  @Get('config')
  @AllowAnonymous()
  getConfig(
    @Query('supplierCountry') supplierCountry: string,
    @Query('customerCountry') customerCountry?: string,
    @Query('transactionType') transactionType?: 'B2B' | 'B2G' | 'B2C',
    @Query('nature') nature?: 'goods' | 'services' | 'mixed',
  ) {
    return this.complianceService.getConfigForFrontend(
      supplierCountry || 'FR',
      customerCountry || null,
      transactionType || 'B2B',
      nature || 'services',
    );
  }

  /**
   * Get list of supported countries
   */
  @Get('countries')
  @AllowAnonymous()
  getAvailableCountries() {
    return this.complianceService.getAvailableCountries();
  }

  /**
   * Get supported transmission platforms
   */
  @Get('platforms')
  @AllowAnonymous()
  getSupportedPlatforms() {
    return this.complianceService.getSupportedPlatforms();
  }

  /**
   * Get raw country configuration (for debugging/admin)
   */
  @Get('country')
  @AllowAnonymous()
  getCountryConfig(@Query('code') code: string) {
    if (!code) {
      return { error: 'Country code required' };
    }
    return this.complianceService.getConfig(code);
  }

  /**
   * Get correction codes for a country
   */
  @Get('correction-codes')
  @AllowAnonymous()
  getCorrectionCodes(@Query('country') country: string) {
    return this.complianceService.getCorrectionCodes(country || 'FR');
  }
}
