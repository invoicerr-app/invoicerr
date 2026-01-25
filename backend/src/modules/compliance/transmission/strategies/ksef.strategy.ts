import { Injectable, Logger } from '@nestjs/common';
import {
  ComplianceSettingsService,
  KSeFConfig,
} from '../../services/compliance-settings.service';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStatus,
  TransmissionStrategy,
} from '../transmission.interface';
import { validateKSeFPayload } from '../validation';

/**
 * KSeF session initiation response
 */
export interface KSeFSessionResponse {
  timestamp: string;
  referenceNumber: string;
  sessionToken: {
    token: string;
    context: {
      contextIdentifier: {
        type: string;
        identifier: string;
      };
    };
  };
}

/**
 * KSeF invoice submission response
 */
export interface KSeFSubmitResponse {
  timestamp: string;
  referenceNumber: string;
  processingCode: number;
  processingDescription: string;
  elementReferenceNumber: string;
  ksefReferenceNumber?: string;
}

/**
 * KSeF invoice status response
 */
export interface KSeFStatusResponse {
  timestamp: string;
  referenceNumber: string;
  processingCode: number;
  processingDescription: string;
  invoiceStatus?: {
    ksefReferenceNumber: string;
    acquisitionTimestamp: string;
    invoiceNumber: string;
  };
}

/**
 * KSeF transmission strategy for Poland
 *
 * KSeF (Krajowy System e-Faktur) is Poland's national e-invoicing system.
 * It uses a clearance model where invoices are validated and assigned
 * a unique KSeF reference number before being considered valid.
 *
 * Authentication is done via qualified electronic certificates.
 */
@Injectable()
export class KSeFTransmissionStrategy implements TransmissionStrategy {
  readonly name = 'ksef';
  readonly supportedPlatforms = ['ksef'];
  private readonly logger = new Logger(KSeFTransmissionStrategy.name);

  // Session cache per company
  private readonly sessionCache = new Map<string, {
    token: string;
    expiry: number;
  }>();

  constructor(
    private readonly complianceSettingsService: ComplianceSettingsService,
  ) {}

  supports(platform: string): boolean {
    return this.supportedPlatforms.includes(platform);
  }

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    // Validate payload
    const validation = validateKSeFPayload(payload);
    if (!validation.valid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
      return {
        success: false,
        status: 'rejected',
        errorCode: 'KSEF_VALIDATION_ERROR',
        message: `Validation failed: ${errorMessages}`,
      };
    }

    // Get config from database
    const config = await this.complianceSettingsService.getKSeFConfig(payload.companyId);
    if (!config) {
      return {
        success: false,
        status: 'rejected',
        errorCode: 'KSEF_NOT_CONFIGURED',
        message: 'KSeF is not configured. Please configure it in Settings > Compliance.',
      };
    }

    try {
      // Get or create session
      const sessionToken = await this.getSessionToken(payload.companyId, config);

      // Submit invoice to KSeF
      const result = await this.submitInvoice(payload.xmlContent!, sessionToken, config);

      this.logger.log(
        `Invoice ${payload.invoiceNumber} submitted to KSeF. Reference: ${result.elementReferenceNumber}`,
      );

      // If we already have the KSeF reference number, include it
      if (result.ksefReferenceNumber) {
        return {
          success: true,
          status: 'accepted',
          externalId: result.ksefReferenceNumber,
          validationUrl: `${config.webUrl}/web/verify/${result.ksefReferenceNumber}`,
          message: `Invoice accepted by KSeF. Number: ${result.ksefReferenceNumber}`,
          metadata: {
            elementReferenceNumber: result.elementReferenceNumber,
            processingCode: result.processingCode,
          },
        };
      }

      // Otherwise return the element reference for status polling
      return {
        success: true,
        status: 'submitted',
        externalId: result.elementReferenceNumber,
        message: `Invoice submitted to KSeF. Reference: ${result.elementReferenceNumber}`,
        metadata: {
          processingCode: result.processingCode,
          processingDescription: result.processingDescription,
        },
      };
    } catch (error) {
      this.logger.error('KSeF transmission failed:', error);
      return {
        success: false,
        status: 'rejected',
        errorCode: 'KSEF_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async checkStatus(externalId: string, companyId?: string): Promise<TransmissionStatus> {
    if (!companyId) {
      this.logger.warn('Company ID required for KSeF status check');
      return 'pending';
    }

    const config = await this.complianceSettingsService.getKSeFConfig(companyId);
    if (!config) {
      this.logger.warn('KSeF not configured for company');
      return 'pending';
    }

    try {
      const sessionToken = await this.getSessionToken(companyId, config);

      const response = await fetch(
        `${config.apiUrl}/online/Invoice/Status/${externalId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            SessionToken: sessionToken,
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`KSeF status check failed: ${response.status} - ${errorText}`);
        return 'pending';
      }

      const result: KSeFStatusResponse = await response.json();
      return this.mapKSeFStatus(result);
    } catch (error) {
      this.logger.error('Failed to check KSeF status:', error);
      return 'pending';
    }
  }

  async cancel(_externalId: string): Promise<boolean> {
    // KSeF doesn't support cancellation
    // Corrections must be done via corrective invoices (faktura korygująca)
    return false;
  }

  /**
   * Get or create a KSeF session token
   */
  private async getSessionToken(companyId: string, config: KSeFConfig): Promise<string> {
    const cached = this.sessionCache.get(companyId);
    if (cached && Date.now() < cached.expiry) {
      return cached.token;
    }

    const sessionData = await this.initiateSession(config);

    // Cache for 4 hours (KSeF sessions last 5 hours)
    const expiry = Date.now() + 4 * 60 * 60 * 1000;
    this.sessionCache.set(companyId, {
      token: sessionData.sessionToken.token,
      expiry,
    });

    return sessionData.sessionToken.token;
  }

  /**
   * Initiate a KSeF session using qualified certificate
   */
  private async initiateSession(config: KSeFConfig): Promise<KSeFSessionResponse> {
    // Build the authorization challenge request
    const challengeRequest = {
      contextIdentifier: {
        type: 'onip',
        identifier: config.nip,
      },
    };

    // Step 1: Get authorization challenge
    const challengeResponse = await fetch(
      `${config.apiUrl}/online/Session/AuthorisationChallenge`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(challengeRequest),
      },
    );

    if (!challengeResponse.ok) {
      const errorText = await challengeResponse.text();
      throw new Error(`KSeF challenge request failed: ${challengeResponse.status} - ${errorText}`);
    }

    const challenge = await challengeResponse.json();

    // Step 2: Sign the challenge with the qualified certificate
    const signedToken = await this.signChallenge(challenge.challenge, config);

    // Step 3: Initiate signed session
    const sessionRequest = {
      context: {
        contextIdentifier: {
          type: 'onip',
          identifier: config.nip,
        },
        contextName: {
          type: 'fn',
          tradeName: config.companyName || 'Company',
        },
      },
      identifier: {
        type: 'onip',
        identifier: config.nip,
      },
      signedInit: {
        encoding: 'Base64',
        algorithm: 'SHA256withRSA',
        signatureValue: signedToken,
        certificate: config.certificatePem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\n/g, ''),
      },
      challenge: challenge.challenge,
      timestamp: challenge.timestamp,
    };

    const sessionResponse = await fetch(
      `${config.apiUrl}/online/Session/InitSigned`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sessionRequest),
      },
    );

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      throw new Error(`KSeF session initiation failed: ${sessionResponse.status} - ${errorText}`);
    }

    return sessionResponse.json();
  }

  /**
   * Sign the KSeF challenge with the private key
   */
  private async signChallenge(challenge: string, config: KSeFConfig): Promise<string> {
    // Use Node.js crypto for RSA signing
    const crypto = await import('crypto');

    const sign = crypto.createSign('SHA256');
    sign.update(challenge);
    sign.end();

    const signature = sign.sign({
      key: config.privateKeyPem,
      passphrase: config.password,
    });

    return signature.toString('base64');
  }

  /**
   * Submit an invoice to KSeF
   */
  private async submitInvoice(
    xmlContent: string,
    sessionToken: string,
    config: KSeFConfig,
  ): Promise<KSeFSubmitResponse> {
    // KSeF expects the invoice in FA(2) or FA(3) XML format
    // The XML should be base64 encoded in the request
    const invoicePayload = {
      invoiceHash: {
        hashSHA: {
          algorithm: 'SHA-256',
          encoding: 'Base64',
          value: await this.computeSHA256(xmlContent),
        },
        fileSize: Buffer.byteLength(xmlContent, 'utf8'),
      },
      invoicePayload: {
        type: 'plain',
        invoiceBody: Buffer.from(xmlContent).toString('base64'),
      },
    };

    const response = await fetch(
      `${config.apiUrl}/online/Invoice/Send`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          SessionToken: sessionToken,
        },
        body: JSON.stringify(invoicePayload),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`KSeF invoice submission failed: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Compute SHA-256 hash of content
   */
  private async computeSHA256(content: string): Promise<string> {
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(content, 'utf8');
    return hash.digest('base64');
  }

  /**
   * Map KSeF status to transmission status
   */
  private mapKSeFStatus(response: KSeFStatusResponse): TransmissionStatus {
    // KSeF processing codes:
    // 200 - Success, invoice processed
    // 202 - In progress
    // 400-499 - Client errors (rejected)
    // 500-599 - Server errors (pending retry)

    if (response.invoiceStatus?.ksefReferenceNumber) {
      return 'accepted';
    }

    const code = response.processingCode;
    if (code >= 200 && code < 300) {
      return response.invoiceStatus ? 'accepted' : 'validated';
    } else if (code >= 400 && code < 500) {
      return 'rejected';
    }

    return 'pending';
  }
}
