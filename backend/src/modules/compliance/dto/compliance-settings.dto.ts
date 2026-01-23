/**
 * DTO for updating compliance settings
 */
export interface UpdateComplianceSettingsDto {
  // ===== Chorus Pro (France B2G) =====
  chorusApiUrl?: string;
  chorusClientId?: string;
  chorusClientSecret?: string;
  chorusTechnicalAccountId?: string;

  // ===== SuperPDP / PDP (France B2B) =====
  pdpApiUrl?: string;
  pdpApiKey?: string;
  pdpClientId?: string;
  pdpProvider?: string;

  // ===== Peppol =====
  peppolAccessPointUrl?: string;
  peppolSenderId?: string;
  peppolCertificatePem?: string;
  peppolPrivateKeyPem?: string;
  peppolEnvironment?: string;

  // ===== SdI - Sistema di Interscambio (Italy) =====
  sdiApiUrl?: string;
  sdiCertificatePem?: string;
  sdiPrivateKeyPem?: string;
  sdiCertificatePassword?: string;

  // ===== Verifactu (Spain) =====
  verifactuApiUrl?: string;
  verifactuCertificatePem?: string;
  verifactuPrivateKeyPem?: string;
  verifactuNif?: string;

  // ===== SAF-T (Portugal) =====
  saftSoftwareCertificateNumber?: string;
  saftHashValidationKey?: string;

  // ===== General settings =====
  defaultTransmissionPlatform?: string;
  enableAutoTransmission?: boolean;
}

/**
 * Response DTO for compliance settings (masks sensitive fields)
 */
export interface ComplianceSettingsResponseDto {
  id: string;
  companyId: string;

  // Chorus Pro - mask secrets
  chorusApiUrl: string | null;
  chorusClientId: string | null;
  chorusClientSecretSet: boolean;
  chorusTechnicalAccountId: string | null;

  // PDP - mask secrets
  pdpApiUrl: string | null;
  pdpApiKeySet: boolean;
  pdpClientId: string | null;
  pdpProvider: string | null;

  // Peppol - mask keys
  peppolAccessPointUrl: string | null;
  peppolSenderId: string | null;
  peppolCertificateSet: boolean;
  peppolPrivateKeySet: boolean;
  peppolEnvironment: string | null;

  // SdI - mask keys
  sdiApiUrl: string | null;
  sdiCertificateSet: boolean;
  sdiPrivateKeySet: boolean;

  // Verifactu - mask keys
  verifactuApiUrl: string | null;
  verifactuCertificateSet: boolean;
  verifactuPrivateKeySet: boolean;
  verifactuNif: string | null;

  // SAF-T - mask keys
  saftSoftwareCertificateNumber: string | null;
  saftHashValidationKeySet: boolean;

  // General
  defaultTransmissionPlatform: string | null;
  enableAutoTransmission: boolean;

  createdAt: Date;
  updatedAt: Date;
}
