import { Injectable, } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ComplianceSettings } from '../../../../prisma/generated/prisma/client';
import {
  ComplianceSettingsResponseDto,
  UpdateComplianceSettingsDto,
} from '../dto/compliance-settings.dto';

/**
 * Compliance Settings Service
 *
 * Manages company-specific compliance configuration.
 * Country-specific platform configs (Chorus, SdI, KSeF, etc.)
 * can be added as needed.
 */
@Injectable()
export class ComplianceSettingsService {

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get compliance settings for a company
   */
  async getSettings(companyId: string): Promise<ComplianceSettings | null> {
    return this.prisma.complianceSettings.findUnique({
      where: { companyId },
    });
  }

  /**
   * Get or create compliance settings for a company
   */
  async getOrCreateSettings(companyId: string): Promise<ComplianceSettings> {
    const existing = await this.getSettings(companyId);
    if (existing) {
      return existing;
    }

    return this.prisma.complianceSettings.create({
      data: { companyId },
    });
  }

  /**
   * Update compliance settings for a company
   */
  async updateSettings(
    companyId: string,
    data: UpdateComplianceSettingsDto,
  ): Promise<ComplianceSettings> {
    // Ensure settings exist
    await this.getOrCreateSettings(companyId);

    return this.prisma.complianceSettings.update({
      where: { companyId },
      data,
    });
  }

  /**
   * Get settings response DTO (masks sensitive fields)
   */
  async getSettingsResponse(companyId: string): Promise<ComplianceSettingsResponseDto | null> {
    const settings = await this.getSettings(companyId);
    if (!settings) {
      return null;
    }

    return this.toResponseDto(settings);
  }

  /**
   * Convert settings to response DTO (masks sensitive fields)
   */
  private toResponseDto(settings: ComplianceSettings): ComplianceSettingsResponseDto {
    return {
      id: settings.id,
      companyId: settings.companyId,

      // Chorus Pro
      chorusApiUrl: settings.chorusApiUrl,
      chorusClientId: settings.chorusClientId,
      chorusClientSecretSet: !!settings.chorusClientSecret,
      chorusTechnicalAccountId: settings.chorusTechnicalAccountId,

      // PDP
      pdpApiUrl: settings.pdpApiUrl,
      pdpApiKeySet: !!settings.pdpApiKey,
      pdpClientId: settings.pdpClientId,
      pdpProvider: settings.pdpProvider,

      // Peppol
      peppolAccessPointUrl: settings.peppolAccessPointUrl,
      peppolSenderId: settings.peppolSenderId,
      peppolCertificateSet: !!settings.peppolCertificatePem,
      peppolPrivateKeySet: !!settings.peppolPrivateKeyPem,
      peppolEnvironment: settings.peppolEnvironment,

      // SdI
      sdiApiUrl: settings.sdiApiUrl,
      sdiCertificateSet: !!settings.sdiCertificatePem,
      sdiPrivateKeySet: !!settings.sdiPrivateKeyPem,

      // Verifactu
      verifactuApiUrl: settings.verifactuApiUrl,
      verifactuCertificateSet: !!settings.verifactuCertificatePem,
      verifactuPrivateKeySet: !!settings.verifactuPrivateKeyPem,
      verifactuNif: settings.verifactuNif,

      // SAF-T
      saftSoftwareCertificateNumber: settings.saftSoftwareCertificateNumber,
      saftHashValidationKeySet: !!settings.saftHashValidationKey,

      // General
      defaultTransmissionPlatform: settings.defaultTransmissionPlatform,
      enableAutoTransmission: settings.enableAutoTransmission,

      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  /**
   * Check which platforms are configured for a company
   *
   * Currently only email is available.
   * Add country-specific platform checks as needed.
   */
  async getConfiguredPlatforms(_companyId: string): Promise<string[]> {
    // Email is always available as the basic transmission method
    return ['email'];
  }
}
