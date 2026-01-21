import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStrategy,
} from '../transmission.interface';

interface ChorusConfig {
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  technicalAccountId: string;
}

interface ChorusTokenResponse {
  access_token: string;
  expires_in: number;
}

interface ChorusSubmitResponse {
  idFlux: string;
  dateDepot: string;
  statutCourant: string;
}

@Injectable()
export class ChorusTransmissionStrategy implements TransmissionStrategy {
  readonly name = 'chorus';
  private readonly logger = new Logger(ChorusTransmissionStrategy.name);
  private readonly config: ChorusConfig | null;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(private readonly configService: ConfigService) {
    this.config = this.loadConfig();
  }

  private loadConfig(): ChorusConfig | null {
    const apiUrl = this.configService.get<string>('CHORUS_API_URL');
    const clientId = this.configService.get<string>('CHORUS_CLIENT_ID');
    const clientSecret = this.configService.get<string>('CHORUS_CLIENT_SECRET');
    const technicalAccountId = this.configService.get<string>('CHORUS_TECHNICAL_ACCOUNT_ID');

    if (!apiUrl || !clientId || !clientSecret || !technicalAccountId) {
      this.logger.warn('Chorus Pro configuration incomplete. Strategy will fail on send.');
      return null;
    }

    return { apiUrl, clientId, clientSecret, technicalAccountId };
  }

  supports(platform: string): boolean {
    return platform === 'chorus';
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    if (!this.config) {
      throw new Error('Chorus Pro not configured');
    }

    const response = await fetch(`${this.config.apiUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        scope: 'openid',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to obtain Chorus Pro access token: ${response.status}`);
    }

    const data: ChorusTokenResponse = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // Refresh 1 min before expiry

    return this.accessToken;
  }

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    if (!this.config) {
      return {
        success: false,
        errorCode: 'CHORUS_NOT_CONFIGURED',
        message: 'Chorus Pro API credentials are not configured',
      };
    }

    try {
      const token = await this.getAccessToken();

      // Chorus Pro expects a specific XML format (UBL or CII)
      // For simplicity, we'll submit the PDF with metadata
      // In production, you'd generate proper Factur-X XML

      const formData = new FormData();

      formData.append(
        'fichierFlux',
        new Blob([new Uint8Array(payload.pdfBuffer)], { type: 'application/pdf' }),
        `invoice-${payload.invoiceNumber}.pdf`,
      );

      formData.append('syntaxeFlux', 'IN_DP_E2_FACTURX_MINIMUM');
      formData.append('idUtilisateurCourant', this.config.technicalAccountId);

      const response = await fetch(`${this.config.apiUrl}/cpro/factures/v1/deposer/flux`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Chorus Pro API error: ${response.status} - ${errorText}`);
        return {
          success: false,
          errorCode: `CHORUS_HTTP_${response.status}`,
          message: errorText,
        };
      }

      const result: ChorusSubmitResponse = await response.json();

      return {
        success: true,
        externalId: result.idFlux,
        message: `Invoice submitted to Chorus Pro. Status: ${result.statutCourant}`,
      };
    } catch (error) {
      this.logger.error('Chorus Pro transmission failed:', error);
      return {
        success: false,
        errorCode: 'CHORUS_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
