import { Body, Controller, Get, NotFoundException, Patch, Query } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { PrismaService } from '@/prisma/prisma.service';
import { ComplianceService } from './compliance.service';
import { UpdateComplianceSettingsDto } from './dto/compliance-settings.dto';
import { ComplianceSettingsService } from './services/compliance-settings.service';

@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly complianceService: ComplianceService,
    private readonly complianceSettingsService: ComplianceSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Helper to get the current company (single-tenant mode)
   */
  private async getCurrentCompanyId(): Promise<string> {
    const company = await this.prisma.company.findFirst({ select: { id: true } });
    if (!company) {
      throw new NotFoundException('No company found');
    }
    return company.id;
  }

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
   * Get company identifier config for a country (for onboarding)
   * Returns all company identifiers with label, format regex, example, and required flag
   * Returns empty array for unsupported countries (generic config)
   */
  @Get('identifiers')
  @AllowAnonymous()
  getIdentifierConfig(@Query('country') country: string) {
    if (!country) {
      return {
        identifiers: [],
        vat: { labelKey: null, format: null, example: null },
      };
    }

    const config = this.complianceService.getConfig(country);
    const companyIdentifiers = config.identifiers?.company || [];

    return {
      identifiers: companyIdentifiers.map((id) => ({
        id: id.id,
        labelKey: id.labelKey,
        format: id.format,
        example: id.example || null,
        required: id.required,
        maxLength: id.maxLength || null,
      })),
      vat: {
        labelKey: 'identifiers.vat',
        format: config.vat?.numberFormat || null,
        example: config.vat?.numberPrefix
          ? `${config.vat.numberPrefix}123456789`
          : null,
      },
    };
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
   * Get compliance settings for the current company
   * Returns masked sensitive fields (only shows if set, not the actual values)
   */
  @Get('settings')
  async getComplianceSettings() {
    const companyId = await this.getCurrentCompanyId();
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
   * Update compliance settings for the current company
   * Used to configure API credentials for various platforms
   */
  @Patch('settings')
  async updateComplianceSettings(@Body() dto: UpdateComplianceSettingsDto) {
    const companyId = await this.getCurrentCompanyId();
    await this.complianceSettingsService.updateSettings(companyId, dto);
    const response = await this.complianceSettingsService.getSettingsResponse(companyId);
    return {
      success: true,
      message: 'Compliance settings updated successfully',
      settings: response,
    };
  }

  /**
   * Get configured platforms for the current company
   * Returns list of platforms that have valid configuration
   */
  @Get('settings/platforms')
  async getConfiguredPlatforms() {
    const companyId = await this.getCurrentCompanyId();
    const platforms = await this.complianceSettingsService.getConfiguredPlatforms(companyId);
    return {
      companyId,
      platforms,
      count: platforms.length,
    };
  }
}
