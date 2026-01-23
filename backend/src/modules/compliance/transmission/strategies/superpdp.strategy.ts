import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStatus,
  TransmissionStrategy,
} from '../transmission.interface';

interface SuperPDPConfig {
  apiUrl: string;
  apiKey: string;
  clientId: string;
}

interface SuperPDPResponse {
  id: string;
  status: 'ACCEPTED' | 'REJECTED' | 'PENDING';
  message?: string;
  errorCode?: string;
}

@Injectable()
export class SuperPDPTransmissionStrategy implements TransmissionStrategy {
  readonly name = 'superpdp';
  readonly supportedPlatforms = ['superpdp'];
  private readonly logger = new Logger(SuperPDPTransmissionStrategy.name);
  private readonly config: SuperPDPConfig | null;

  constructor(private readonly configService: ConfigService) {
    this.config = this.loadConfig();
  }

  private loadConfig(): SuperPDPConfig | null {
    const apiUrl = this.configService.get<string>('SUPERPDP_API_URL');
    const apiKey = this.configService.get<string>('SUPERPDP_API_KEY');
    const clientId = this.configService.get<string>('SUPERPDP_CLIENT_ID');

    if (!apiUrl || !apiKey || !clientId) {
      this.logger.warn('SuperPDP configuration incomplete. Strategy will fail on send.');
      return null;
    }

    return { apiUrl, apiKey, clientId };
  }

  supports(platform: string): boolean {
    return platform === 'superpdp';
  }

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    if (!this.config) {
      return {
        success: false,
        status: 'rejected',
        errorCode: 'SUPERPDP_NOT_CONFIGURED',
        message: 'SuperPDP API credentials are not configured',
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

      const response = await fetch(`${this.config.apiUrl}/invoices/submit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'X-Client-Id': this.config.clientId,
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

  async checkStatus(_externalId: string): Promise<TransmissionStatus> {
    // SuperPDP status check would need to be implemented
    // For now, return pending
    return 'pending';
  }

  async cancel(_externalId: string): Promise<boolean> {
    // SuperPDP doesn't support cancellation
    return false;
  }
}
