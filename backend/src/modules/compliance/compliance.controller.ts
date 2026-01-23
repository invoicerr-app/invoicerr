import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { ComplianceService } from './compliance.service';
import { UpdateComplianceSettingsDto } from './dto/compliance-settings.dto';
import { ComplianceSettingsService } from './services/compliance-settings.service';

@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly complianceService: ComplianceService,
    private readonly complianceSettingsService: ComplianceSettingsService,
  ) {}

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

  // ==================== COMPLIANCE SETTINGS ====================

  /**
   * Get compliance settings for a company
   * Returns masked sensitive fields (only shows if set, not the actual values)
   */
  @Get('settings/:companyId')
  async getComplianceSettings(@Param('companyId') companyId: string) {
    const settings = await this.complianceSettingsService.getSettingsResponse(companyId);
    if (!settings) {
      // Return empty settings structure if none exist
      return {
        companyId,
        configured: false,
        message: 'No compliance settings configured for this company',
      };
    }
    return { ...settings, configured: true };
  }

  /**
   * Update compliance settings for a company
   * Used to configure API credentials for various platforms
   */
  @Patch('settings/:companyId')
  async updateComplianceSettings(
    @Param('companyId') companyId: string,
    @Body() dto: UpdateComplianceSettingsDto,
  ) {
    const settings = await this.complianceSettingsService.updateSettings(companyId, dto);
    const response = await this.complianceSettingsService.getSettingsResponse(companyId);
    return {
      success: true,
      message: 'Compliance settings updated successfully',
      settings: response,
    };
  }

  /**
   * Get configured platforms for a company
   * Returns list of platforms that have valid configuration
   */
  @Get('settings/:companyId/platforms')
  async getConfiguredPlatforms(@Param('companyId') companyId: string) {
    const platforms = await this.complianceSettingsService.getConfiguredPlatforms(companyId);
    return {
      companyId,
      platforms,
      count: platforms.length,
    };
  }
}
