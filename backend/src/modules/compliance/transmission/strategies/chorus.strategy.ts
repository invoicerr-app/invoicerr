import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStatus,
  TransmissionStrategy,
} from '../transmission.interface';
import { validateChorusPayload } from '../validation';

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

interface ChorusStatusResponse {
  idFlux: string;
  statutCourant: string;
  libelleStatutCourant: string;
  dateStatutCourant: string;
  codeRetour?: string;
  libelleRetour?: string;
}

@Injectable()
export class ChorusTransmissionStrategy implements TransmissionStrategy {
  readonly name = 'chorus';
  readonly supportedPlatforms = ['chorus'];
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
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

    return this.accessToken;
  }

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    // Validate payload
    const validation = validateChorusPayload(payload);
    if (!validation.valid) {
      const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
      return {
        success: false,
        status: 'rejected',
        errorCode: 'CHORUS_VALIDATION_ERROR',
        message: `Validation failed: ${errorMessages}`,
      };
    }

    if (!this.config) {
      return {
        success: false,
        status: 'rejected',
        errorCode: 'CHORUS_NOT_CONFIGURED',
        message: 'Chorus Pro API credentials are not configured',
      };
    }

    try {
      const token = await this.getAccessToken();

      const formData = new FormData();

      // Determine syntax based on format
      let syntaxe = 'IN_DP_E2_FACTURX_MINIMUM';
      if (payload.format === 'facturx') {
        syntaxe = payload.xmlContent
          ? 'IN_DP_E2_FACTURX_EXTENDED'
          : 'IN_DP_E2_FACTURX_MINIMUM';
      } else if (payload.format === 'ubl') {
        syntaxe = 'IN_DP_E2_UBL_INVOICE';
      }

      // If XML content is provided, submit it
      if (payload.xmlContent) {
        formData.append(
          'fichierFlux',
          new Blob([payload.xmlContent], { type: 'application/xml' }),
          `invoice-${payload.invoiceNumber}.xml`,
        );
      } else {
        // Otherwise submit PDF
        formData.append(
          'fichierFlux',
          new Blob([new Uint8Array(payload.pdfBuffer)], { type: 'application/pdf' }),
          `invoice-${payload.invoiceNumber}.pdf`,
        );
      }

      formData.append('syntaxeFlux', syntaxe);
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
          status: 'rejected',
          errorCode: `CHORUS_HTTP_${response.status}`,
          message: errorText,
        };
      }

      const result: ChorusSubmitResponse = await response.json();

      this.logger.log(
        `Invoice ${payload.invoiceNumber} submitted to Chorus Pro with ID ${result.idFlux}`,
      );

      return {
        success: true,
        status: 'submitted',
        externalId: result.idFlux,
        message: `Invoice submitted to Chorus Pro. Status: ${result.statutCourant}`,
      };
    } catch (error) {
      this.logger.error('Chorus Pro transmission failed:', error);
      return {
        success: false,
        status: 'rejected',
        errorCode: 'CHORUS_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async checkStatus(externalId: string): Promise<TransmissionStatus> {
    if (!this.config) {
      throw new Error('Chorus Pro not configured');
    }

    try {
      const token = await this.getAccessToken();

      const response = await fetch(
        `${this.config.apiUrl}/cpro/factures/v1/consulter/statut?idFlux=${externalId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        this.logger.error(`Failed to check Chorus Pro status: ${response.status}`);
        return 'pending';
      }

      const result: ChorusStatusResponse = await response.json();

      // Map Chorus status to our status
      return this.mapChorusStatus(result.statutCourant);
    } catch (error) {
      this.logger.error('Failed to check Chorus Pro status:', error);
      return 'pending';
    }
  }

  async cancel(externalId: string): Promise<boolean> {
    // Chorus Pro doesn't support cancellation via API
    this.logger.warn(`Cancellation not supported for Chorus Pro. ID: ${externalId}`);
    return false;
  }

  private mapChorusStatus(chorusStatus: string): TransmissionStatus {
    // Chorus Pro statuses: DEPOSEE, MISE_A_DISPOSITION, REJETEE, TRANSMISE, etc.
    const statusMap: Record<string, TransmissionStatus> = {
      DEPOSEE: 'submitted',
      EN_COURS_DE_TRAITEMENT: 'submitted',
      MISE_A_DISPOSITION: 'validated',
      TRANSMISE: 'delivered',
      ACCEPTEE: 'accepted',
      REFUSEE: 'rejected',
      REJETEE: 'rejected',
    };

    return statusMap[chorusStatus] || 'pending';
  }
}
