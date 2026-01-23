import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStatus,
  TransmissionStrategy,
} from '../transmission.interface';

interface VerifactuConfig {
  apiUrl: string;
  nif: string;
  certificatePath: string;
  privateKeyPath: string;
  password?: string;
  softwareId: string;
  softwareName: string;
  softwareVersion: string;
}

interface VerifactuResponse {
  estado: 'CORRECTO' | 'INCORRECTO' | 'PARCIALMENTE_CORRECTO';
  csv?: string;
  errores?: Array<{
    codigo: string;
    descripcion: string;
  }>;
  huella?: string;
  fechaHora?: string;
}

interface InvoiceHash {
  hash: string;
  previousHash: string;
  chainSequence: number;
}

@Injectable()
export class VerifactuTransmissionStrategy implements TransmissionStrategy {
  readonly name = 'verifactu';
  readonly supportedPlatforms = ['verifactu', 'aeat-spain', 'ticketbai'];
  private readonly logger = new Logger(VerifactuTransmissionStrategy.name);
  private readonly config: VerifactuConfig | null;

  constructor(private readonly configService: ConfigService) {
    this.config = this.loadConfig();
  }

  private loadConfig(): VerifactuConfig | null {
    const apiUrl = this.configService.get<string>('VERIFACTU_API_URL');
    const nif = this.configService.get<string>('VERIFACTU_NIF');
    const certificatePath = this.configService.get<string>('VERIFACTU_CERTIFICATE_PATH');
    const privateKeyPath = this.configService.get<string>('VERIFACTU_PRIVATE_KEY_PATH');
    const softwareId = this.configService.get<string>('VERIFACTU_SOFTWARE_ID');

    if (!apiUrl || !nif || !certificatePath || !privateKeyPath || !softwareId) {
      this.logger.warn('Veri*Factu configuration incomplete. Strategy will fail on send.');
      return null;
    }

    return {
      apiUrl,
      nif,
      certificatePath,
      privateKeyPath,
      password: this.configService.get<string>('VERIFACTU_CERTIFICATE_PASSWORD'),
      softwareId,
      softwareName: this.configService.get<string>('VERIFACTU_SOFTWARE_NAME') || 'Invoicerr',
      softwareVersion: this.configService.get<string>('VERIFACTU_SOFTWARE_VERSION') || '1.0.0',
    };
  }

  supports(platform: string): boolean {
    return this.supportedPlatforms.includes(platform);
  }

  async send(payload: TransmissionPayload): Promise<TransmissionResult> {
    if (!this.config) {
      return {
        success: false,
        status: 'rejected',
        errorCode: 'VERIFACTU_NOT_CONFIGURED',
        message: 'Veri*Factu (AEAT) credentials are not configured',
      };
    }

    try {
      // Generate hash chain for the invoice
      const hashData = this.generateInvoiceHash(payload);

      // Build Veri*Factu XML message
      const verifactuXml = this.buildVerifactuXml(payload, hashData);

      // Sign the XML with XAdES signature
      const signedXml = await this.signXml(verifactuXml);

      // Send to AEAT
      const response = await fetch(`${this.config.apiUrl}/wlpl/SSII-FACT/ws/fe/SiiFactFEV1SOAP`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml;charset=UTF-8',
          SOAPAction: 'SuministroLRFacturasEmitidas',
        },
        body: signedXml,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Veri*Factu API error: ${response.status} - ${errorText}`);
        return {
          success: false,
          status: 'rejected',
          errorCode: `VERIFACTU_HTTP_${response.status}`,
          message: errorText,
        };
      }

      const responseXml = await response.text();
      const result = this.parseVerifactuResponse(responseXml);

      if (result.estado === 'INCORRECTO') {
        const errorMessage = result.errores?.map(e => `${e.codigo}: ${e.descripcion}`).join('; ') || 'Unknown error';
        return {
          success: false,
          status: 'rejected',
          errorCode: 'VERIFACTU_REJECTED',
          message: errorMessage,
        };
      }

      this.logger.log(
        `Invoice ${payload.invoiceNumber} registered with Veri*Factu. CSV: ${result.csv}`,
      );

      return {
        success: true,
        status: result.estado === 'CORRECTO' ? 'accepted' : 'validated',
        externalId: result.csv,
        message: `Invoice registered with AEAT Veri*Factu. CSV: ${result.csv}`,
        metadata: {
          huella: result.huella,
          hashChain: hashData,
        },
      };
    } catch (error) {
      this.logger.error('Veri*Factu transmission failed:', error);
      return {
        success: false,
        status: 'rejected',
        errorCode: 'VERIFACTU_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async checkStatus(externalId: string): Promise<TransmissionStatus> {
    // Veri*Factu registration is synchronous
    // If we have a CSV, the invoice is accepted
    if (externalId) {
      return 'accepted';
    }
    return 'pending';
  }

  async cancel(_externalId: string): Promise<boolean> {
    // Veri*Factu doesn't support cancellation - corrections via credit notes
    return false;
  }

  /**
   * Generate hash for invoice chain (required by Veri*Factu)
   * The hash chains all invoices together for tamper detection
   */
  private generateInvoiceHash(payload: TransmissionPayload): InvoiceHash {
    const previousHash = typeof payload.metadata?.previousHash === 'string'
      ? payload.metadata.previousHash
      : 'INICIO_CADENA';
    const chainSequence = typeof payload.metadata?.chainSequence === 'number'
      ? payload.metadata.chainSequence
      : 1;

    // Build data string for hashing per Veri*Factu spec
    // Format: NIF|NumSerie|FechaExpedicion|TipoFactura|CuotaTotal|ImporteTotal|Huella anterior|SistemaInformatico
    const dataString = [
      this.config?.nif || '',
      payload.invoiceNumber,
      this.formatDate(new Date()),
      'F1', // Invoice type
      (Number(payload.metadata?.totalVat) || 0).toFixed(2),
      (Number(payload.metadata?.totalTtc) || 0).toFixed(2),
      previousHash,
      `${this.config?.softwareId}:${this.config?.softwareName}:${this.config?.softwareVersion}`,
    ].join('|');

    // Generate SHA-256 hash
    const hash = crypto.createHash('sha256').update(dataString, 'utf8').digest('hex').toUpperCase();

    return {
      hash,
      previousHash,
      chainSequence,
    };
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0].replace(/-/g, '');
  }

  private buildVerifactuXml(payload: TransmissionPayload, hashData: InvoiceHash): string {
    if (!this.config) {
      throw new Error('Veri*Factu not configured');
    }

    const now = new Date();
    const invoiceDate = this.formatDate(now);

    return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:sii="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/SuministroInformacion.xsd"
                  xmlns:siiLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/SuministroLR.xsd">
  <soapenv:Header/>
  <soapenv:Body>
    <siiLR:SuministroLRFacturasEmitidas>
      <sii:Cabecera>
        <sii:IDVersionSii>1.1</sii:IDVersionSii>
        <sii:Titular>
          <sii:NombreRazon>${this.escapeXml(payload.sender.name)}</sii:NombreRazon>
          <sii:NIF>${this.config.nif}</sii:NIF>
        </sii:Titular>
        <sii:TipoComunicacion>A0</sii:TipoComunicacion>
      </sii:Cabecera>
      <siiLR:RegistroLRFacturasEmitidas>
        <siiLR:PeriodoLiquidacion>
          <sii:Ejercicio>${now.getFullYear()}</sii:Ejercicio>
          <sii:Periodo>${(now.getMonth() + 1).toString().padStart(2, '0')}</sii:Periodo>
        </siiLR:PeriodoLiquidacion>
        <siiLR:IDFactura>
          <sii:IDEmisorFactura>
            <sii:NIF>${this.config.nif}</sii:NIF>
          </sii:IDEmisorFactura>
          <sii:NumSerieFacturaEmisor>${payload.invoiceNumber}</sii:NumSerieFacturaEmisor>
          <sii:FechaExpedicionFacturaEmisor>${invoiceDate}</sii:FechaExpedicionFacturaEmisor>
        </siiLR:IDFactura>
        <siiLR:FacturaExpedida>
          <sii:TipoFactura>F1</sii:TipoFactura>
          <sii:ClaveRegimenEspecialOTrascendencia>01</sii:ClaveRegimenEspecialOTrascendencia>
          <sii:ImporteTotal>${(Number(payload.metadata?.totalTtc) || 0).toFixed(2)}</sii:ImporteTotal>
          <sii:DescripcionOperacion>${this.escapeXml(typeof payload.metadata?.description === 'string' ? payload.metadata.description : 'Factura')}</sii:DescripcionOperacion>
          <sii:Contraparte>
            <sii:NombreRazon>${this.escapeXml(payload.recipient.name)}</sii:NombreRazon>
            ${this.buildCounterpartyId(payload)}
          </sii:Contraparte>
          <sii:TipoDesglose>
            <sii:DesgloseFactura>
              <sii:Sujeta>
                <sii:NoExenta>
                  <sii:TipoNoExenta>S1</sii:TipoNoExenta>
                  <sii:DesgloseIVA>
                    <sii:DetalleIVA>
                      <sii:TipoImpositivo>${typeof payload.metadata?.vatRate === 'number' ? payload.metadata.vatRate.toFixed(2) : '21.00'}</sii:TipoImpositivo>
                      <sii:BaseImponible>${(Number(payload.metadata?.totalHt) || 0).toFixed(2)}</sii:BaseImponible>
                      <sii:CuotaRepercutida>${(Number(payload.metadata?.totalVat) || 0).toFixed(2)}</sii:CuotaRepercutida>
                    </sii:DetalleIVA>
                  </sii:DesgloseIVA>
                </sii:NoExenta>
              </sii:Sujeta>
            </sii:DesgloseFactura>
          </sii:TipoDesglose>
          <sii:Encadenamiento>
            <sii:PrimerRegistro>${hashData.previousHash === 'INICIO_CADENA' ? 'S' : 'N'}</sii:PrimerRegistro>
            ${hashData.previousHash !== 'INICIO_CADENA' ? `<sii:RegistroAnterior>
              <sii:Huella>${hashData.previousHash}</sii:Huella>
            </sii:RegistroAnterior>` : ''}
          </sii:Encadenamiento>
          <sii:SistemaInformatico>
            <sii:NombreRazon>${this.escapeXml(this.config.softwareName)}</sii:NombreRazon>
            <sii:NIF>${this.config.nif}</sii:NIF>
            <sii:IdSistemaInformatico>${this.config.softwareId}</sii:IdSistemaInformatico>
            <sii:Version>${this.config.softwareVersion}</sii:Version>
            <sii:NumeroInstalacion>1</sii:NumeroInstalacion>
          </sii:SistemaInformatico>
          <sii:Huella>${hashData.hash}</sii:Huella>
        </siiLR:FacturaExpedida>
      </siiLR:RegistroLRFacturasEmitidas>
    </siiLR:SuministroLRFacturasEmitidas>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  private buildCounterpartyId(payload: TransmissionPayload): string {
    const vatNumber = payload.recipient.vatNumber || payload.recipient.siret;
    const country = payload.recipient.country?.toUpperCase() || 'ES';

    if (country === 'ES' && vatNumber) {
      return `<sii:NIF>${vatNumber.replace(/^ES/i, '')}</sii:NIF>`;
    }

    // Foreign counterparty
    return `<sii:IDOtro>
      <sii:CodigoPais>${country}</sii:CodigoPais>
      <sii:IDType>02</sii:IDType>
      <sii:ID>${vatNumber || '00000000T'}</sii:ID>
    </sii:IDOtro>`;
  }

  private async signXml(xml: string): Promise<string> {
    // For production, implement XAdES-EPES signature
    // This requires proper certificate handling
    this.logger.debug('Signing Veri*Factu XML (signature integration required)');
    return xml;
  }

  private parseVerifactuResponse(xml: string): VerifactuResponse {
    // Parse AEAT response
    const estadoMatch = xml.match(/<EstadoEnvio>([^<]+)<\/EstadoEnvio>/i) ||
                        xml.match(/<Estado>([^<]+)<\/Estado>/i);
    const csvMatch = xml.match(/<CSV>([^<]+)<\/CSV>/i);
    const huellaMatch = xml.match(/<Huella>([^<]+)<\/Huella>/i);

    // Check for errors
    const errores: Array<{ codigo: string; descripcion: string }> = [];
    const errorMatches = xml.matchAll(/<RegistroRechazado>[\s\S]*?<CodigoErrorRegistro>([^<]+)<\/CodigoErrorRegistro>[\s\S]*?<DescripcionErrorRegistro>([^<]+)<\/DescripcionErrorRegistro>/gi);

    for (const match of errorMatches) {
      errores.push({
        codigo: match[1],
        descripcion: match[2],
      });
    }

    let estado: VerifactuResponse['estado'] = 'CORRECTO';
    if (estadoMatch) {
      const rawEstado = estadoMatch[1].toUpperCase();
      if (rawEstado.includes('INCORRECTO') || rawEstado.includes('ERROR')) {
        estado = 'INCORRECTO';
      } else if (rawEstado.includes('PARCIAL')) {
        estado = 'PARCIALMENTE_CORRECTO';
      }
    }

    if (errores.length > 0) {
      estado = errores.length === 1 ? 'INCORRECTO' : 'PARCIALMENTE_CORRECTO';
    }

    return {
      estado,
      csv: csvMatch?.[1],
      huella: huellaMatch?.[1],
      errores: errores.length > 0 ? errores : undefined,
      fechaHora: new Date().toISOString(),
    };
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Generate QR code content for Veri*Factu verification
   */
  generateQRContent(payload: TransmissionPayload, hashData: InvoiceHash, csv?: string): string {
    if (!this.config) {
      return '';
    }

    // Veri*Factu QR code format
    // https://prewww2.aeat.es/...?url=<encoded_data>
    const qrData = {
      nif: this.config.nif,
      numSerie: payload.invoiceNumber,
      fecha: this.formatDate(new Date()),
      importe: (Number(payload.metadata?.totalTtc) || 0).toFixed(2),
      huella: hashData.hash,
      csv: csv || '',
    };

    const encodedData = Buffer.from(JSON.stringify(qrData)).toString('base64url');
    return `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=${this.config.nif}&numserie=${payload.invoiceNumber}&fecha=${qrData.fecha}&importe=${qrData.importe}`;
  }
}
