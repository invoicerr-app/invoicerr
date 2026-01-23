import { Injectable, Logger } from '@nestjs/common';
import {
  ComplianceSettingsService,
  PDPConfig,
} from '../../services/compliance-settings.service';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStatus,
  TransmissionStrategy,
} from '../transmission.interface';
import { validatePDPPayload } from '../validation';

interface SuperPDPResponse {
  id: string;
  status: 'ACCEPTED' | 'REJECTED' | 'PENDING';
  message?: string;
  errorCode?: string;
}

@Injectable()
export class SuperPDPTransmissionStrategy implements TransmissionStrategy {
  readonly name = 'superpdp';
  readonly supportedPlatforms = ['superpdp', 'pdp'];
  private readonly logger = new Logger(SuperPDPTransmissionStrategy.name);

  constructor(
    private readonly complianceSettingsService: ComplianceSettingsService,
  ) {}

  supports(platform: string): boolean {
    return this.supportedPlatforms.includes(platform);
  }

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    // Validate payload
    const validation = validatePDPPayload(payload);
    if (!validation.valid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
      return {
        success: false,
        status: 'rejected',
        errorCode: 'SUPERPDP_VALIDATION_ERROR',
        message: `Validation failed: ${errorMessages}`,
      };
    }

    // Get config from database
    const config = await this.complianceSettingsService.getPDPConfig(payload.companyId);
    if (!config) {
      return {
        success: false,
        status: 'rejected',
        errorCode: 'SUPERPDP_NOT_CONFIGURED',
        message: 'PDP API credentials are not configured. Please configure them in Settings > Compliance.',
      };
    }

    try {
      const formData = new FormData();

      // Add invoice metadata
      formData.append(
        'metadata',
        JSON.stringify({
          invoiceNumber: payload.invoiceNumber,
          sender: {
            siret: payload.sender.siret,
            vatNumber: payload.sender.vatNumber,
            name: payload.sender.name,
          },
          recipient: {
            siret: payload.recipient.siret,
            vatNumber: payload.recipient.vatNumber,
            name: payload.recipient.name,
          },
        }),
      );

      // Add PDF file
      const pdfBlob = new Blob([new Uint8Array(payload.pdfBuffer)], { type: 'application/pdf' });
      formData.append('invoice', pdfBlob, `invoice-${payload.invoiceNumber}.pdf`);

      // Add XML if present (Factur-X)
      if (payload.xmlContent) {
        const xmlBlob = new Blob([payload.xmlContent], { type: 'application/xml' });
        formData.append('xml', xmlBlob, `invoice-${payload.invoiceNumber}.xml`);
      }

      const response = await fetch(`${config.apiUrl}/invoices/submit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'X-Client-Id': config.clientId,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`SuperPDP API error: ${response.status} - ${errorText}`);
        return {
          success: false,
          status: 'rejected',
          errorCode: `SUPERPDP_HTTP_${response.status}`,
          message: errorText,
        };
      }

      const result: SuperPDPResponse = await response.json();

      if (result.status === 'REJECTED') {
        return {
          success: false,
          status: 'rejected',
          externalId: result.id,
          errorCode: result.errorCode || 'SUPERPDP_REJECTED',
          message: result.message || 'Invoice rejected by SuperPDP',
        };
      }

      const status: TransmissionStatus = result.status === 'PENDING' ? 'submitted' : 'accepted';

      return {
        success: true,
        status,
        externalId: result.id,
        message:
          result.status === 'PENDING'
            ? 'Invoice submitted, pending validation'
            : 'Invoice accepted',
      };
    } catch (error) {
      this.logger.error('SuperPDP transmission failed:', error);
      return {
        success: false,
        status: 'rejected',
        errorCode: 'SUPERPDP_NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  async checkStatus(_externalId: string, _companyId?: string): Promise<TransmissionStatus> {
    // SuperPDP status check would need to be implemented
    // For now, return pending
    return 'pending';
  }

  async cancel(_externalId: string): Promise<boolean> {
    // SuperPDP doesn't support cancellation
    return false;
  }
}
