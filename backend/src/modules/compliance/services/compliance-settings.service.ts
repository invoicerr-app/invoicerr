import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ComplianceSettings } from '../../../../prisma/generated/prisma/client';
import {
  ComplianceSettingsResponseDto,
  UpdateComplianceSettingsDto,
} from '../dto/compliance-settings.dto';

/**
 * Platform-specific configuration extracted from ComplianceSettings
 */
export interface ChorusConfig {
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  technicalAccountId: string;
}

export interface PDPConfig {
  apiUrl: string;
  apiKey: string;
  clientId: string;
  provider?: string;
}

export interface PeppolConfig {
  accessPointUrl: string;
  senderId: string;
  certificatePem?: string;
  privateKeyPem?: string;
  environment: 'test' | 'production';
  smlDomain: string;
}

export interface SdIConfig {
  apiUrl: string;
  certificatePem: string;
  privateKeyPem: string;
  password?: string;
}

export interface VerifactuConfig {
  apiUrl: string;
  certificatePem: string;
  privateKeyPem: string;
  nif: string;
}

export interface SaftConfig {
  softwareCertificateNumber: string;
  hashValidationKey: string;
}

export interface KSeFConfig {
  apiUrl: string;
  webUrl: string;
  nip: string;
  companyName?: string;
  certificatePem: string;
  privateKeyPem: string;
  password?: string;
  environment: 'test' | 'production';
}

@Injectable()
export class ComplianceSettingsService {
  private readonly logger = new Logger(ComplianceSettingsService.name);

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

  // ========== Platform-specific config extractors ==========

  /**
   * Get Chorus Pro configuration for a company
   */
  async getChorusConfig(companyId: string): Promise<ChorusConfig | null> {
    const settings = await this.getSettings(companyId);
    if (
      !settings?.chorusApiUrl ||
      !settings?.chorusClientId ||
      !settings?.chorusClientSecret ||
      !settings?.chorusTechnicalAccountId
    ) {
      return null;
    }

    return {
      apiUrl: settings.chorusApiUrl,
      clientId: settings.chorusClientId,
      clientSecret: settings.chorusClientSecret,
      technicalAccountId: settings.chorusTechnicalAccountId,
    };
  }

  /**
   * Get PDP configuration for a company
   */
  async getPDPConfig(companyId: string): Promise<PDPConfig | null> {
    const settings = await this.getSettings(companyId);
    if (!settings?.pdpApiUrl || !settings?.pdpApiKey || !settings?.pdpClientId) {
      return null;
    }

    return {
      apiUrl: settings.pdpApiUrl,
      apiKey: settings.pdpApiKey,
      clientId: settings.pdpClientId,
      provider: settings.pdpProvider || undefined,
    };
  }

  /**
   * Get Peppol configuration for a company
   */
  async getPeppolConfig(companyId: string): Promise<PeppolConfig | null> {
    const settings = await this.getSettings(companyId);
    if (!settings?.peppolAccessPointUrl || !settings?.peppolSenderId) {
      return null;
    }

    const environment =
      settings.peppolEnvironment === 'production' ? 'production' : 'test';

    const smlDomain =
      environment === 'production'
        ? 'edelivery.tech.ec.europa.eu'
        : 'acc.edelivery.tech.ec.europa.eu';

    return {
      accessPointUrl: settings.peppolAccessPointUrl,
      senderId: settings.peppolSenderId,
      certificatePem: settings.peppolCertificatePem || undefined,
      privateKeyPem: settings.peppolPrivateKeyPem || undefined,
      environment,
      smlDomain,
    };
  }

  /**
   * Get SdI configuration for a company
   */
  async getSdIConfig(companyId: string): Promise<SdIConfig | null> {
    const settings = await this.getSettings(companyId);
    if (
      !settings?.sdiApiUrl ||
      !settings?.sdiCertificatePem ||
      !settings?.sdiPrivateKeyPem
    ) {
      return null;
    }

    return {
      apiUrl: settings.sdiApiUrl,
      certificatePem: settings.sdiCertificatePem,
      privateKeyPem: settings.sdiPrivateKeyPem,
      password: settings.sdiCertificatePassword || undefined,
    };
  }

  /**
   * Get Verifactu configuration for a company
   */
  async getVerifactuConfig(companyId: string): Promise<VerifactuConfig | null> {
    const settings = await this.getSettings(companyId);
    if (
      !settings?.verifactuApiUrl ||
      !settings?.verifactuCertificatePem ||
      !settings?.verifactuPrivateKeyPem ||
      !settings?.verifactuNif
    ) {
      return null;
    }

    return {
      apiUrl: settings.verifactuApiUrl,
      certificatePem: settings.verifactuCertificatePem,
      privateKeyPem: settings.verifactuPrivateKeyPem,
      nif: settings.verifactuNif,
    };
  }

  /**
   * Get SAF-T configuration for a company
   */
  async getSaftConfig(companyId: string): Promise<SaftConfig | null> {
    const settings = await this.getSettings(companyId);
    if (
      !settings?.saftSoftwareCertificateNumber ||
      !settings?.saftHashValidationKey
    ) {
      return null;
    }

    return {
      softwareCertificateNumber: settings.saftSoftwareCertificateNumber,
      hashValidationKey: settings.saftHashValidationKey,
    };
  }

  /**
   * Get KSeF configuration for a company (Poland)
   *
   * Note: KSeF fields are stored in the generic platformConfig JSON field
   * until dedicated schema fields are added.
   */
  async getKSeFConfig(companyId: string): Promise<KSeFConfig | null> {
    const settings = await this.getSettings(companyId);
    if (!settings) {
      return null;
    }

    // KSeF config is stored in extended settings
    // Check if the company has KSeF-specific configuration
    const extendedConfig = (settings as unknown as Record<string, unknown>);

    const ksefApiUrl = extendedConfig.ksefApiUrl as string | undefined;
    const ksefCertificatePem = extendedConfig.ksefCertificatePem as string | undefined;
    const ksefPrivateKeyPem = extendedConfig.ksefPrivateKeyPem as string | undefined;
    const ksefNip = extendedConfig.ksefNip as string | undefined;

    if (!ksefApiUrl || !ksefCertificatePem || !ksefPrivateKeyPem || !ksefNip) {
      return null;
    }

    const environment = (extendedConfig.ksefEnvironment as string) === 'production'
      ? 'production'
      : 'test';

    const webUrl = environment === 'production'
      ? 'https://ksef.mf.gov.pl'
      : 'https://ksef-test.mf.gov.pl';

    return {
      apiUrl: ksefApiUrl,
      webUrl,
      nip: ksefNip,
      companyName: extendedConfig.ksefCompanyName as string | undefined,
      certificatePem: ksefCertificatePem,
      privateKeyPem: ksefPrivateKeyPem,
      password: extendedConfig.ksefCertificatePassword as string | undefined,
      environment,
    };
  }

  /**
   * Check which platforms are configured for a company
   */
  async getConfiguredPlatforms(companyId: string): Promise<string[]> {
    const platforms: string[] = ['email']; // Email is always available

    const [chorus, pdp, peppol, sdi, verifactu, saft, ksef] = await Promise.all([
      this.getChorusConfig(companyId),
      this.getPDPConfig(companyId),
      this.getPeppolConfig(companyId),
      this.getSdIConfig(companyId),
      this.getVerifactuConfig(companyId),
      this.getSaftConfig(companyId),
      this.getKSeFConfig(companyId),
    ]);

    if (chorus) platforms.push('chorus');
    if (pdp) platforms.push('pdp', 'superpdp');
    if (peppol) platforms.push('peppol', 'xrechnung', 'nlcius', 'ehf');
    if (sdi) platforms.push('sdi', 'fatturaPA');
    if (verifactu) platforms.push('verifactu');
    if (saft) platforms.push('saft');
    if (ksef) platforms.push('ksef');

    return platforms;
  }
}
