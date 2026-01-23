import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface SignatureConfig {
  certificatePath: string;
  privateKeyPath: string;
  password?: string;
}

export interface SignatureResult {
  success: boolean;
  signedXml?: string;
  error?: string;
}

interface CertificateInfo {
  certificate: string;
  privateKey: crypto.KeyObject;
  issuer: string;
  serialNumber: string;
}

@Injectable()
export class XadesSignatureService {
  private readonly logger = new Logger(XadesSignatureService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Sign XML with XAdES-BES signature (required for FatturaPA)
   * XAdES-BES = XML Advanced Electronic Signatures - Basic Electronic Signature
   */
  async signXml(xml: string, config: SignatureConfig): Promise<SignatureResult> {
    try {
      const certInfo = await this.loadCertificate(config);
      const signedXml = this.createXadesSignature(xml, certInfo);

      return {
        success: true,
        signedXml,
      };
    } catch (error) {
      this.logger.error('Failed to sign XML:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown signing error',
      };
    }
  }

  private async loadCertificate(config: SignatureConfig): Promise<CertificateInfo> {
    const certPath = path.resolve(config.certificatePath);
    const keyPath = path.resolve(config.privateKeyPath);

    if (!fs.existsSync(certPath)) {
      throw new Error(`Certificate file not found: ${certPath}`);
    }
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Private key file not found: ${keyPath}`);
    }

    const certPem = fs.readFileSync(certPath, 'utf-8');
    const keyPem = fs.readFileSync(keyPath, 'utf-8');

    const privateKey = crypto.createPrivateKey({
      key: keyPem,
      passphrase: config.password,
    });

    // Extract certificate info
    const certBase64 = this.extractCertificateBase64(certPem);
    const { issuer, serialNumber } = this.parseCertificateInfo(certPem);

    return {
      certificate: certBase64,
      privateKey,
      issuer,
      serialNumber,
    };
  }

  private extractCertificateBase64(certPem: string): string {
    return certPem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');
  }

  private parseCertificateInfo(certPem: string): { issuer: string; serialNumber: string } {
    // Use openssl-like parsing via crypto module
    const cert = new crypto.X509Certificate(certPem);
    return {
      issuer: cert.issuer,
      serialNumber: cert.serialNumber,
    };
  }

  private createXadesSignature(xml: string, certInfo: CertificateInfo): string {
    const signatureId = `Signature-${crypto.randomUUID()}`;
    const signedPropertiesId = `SignedProperties-${crypto.randomUUID()}`;
    const keyInfoId = `KeyInfo-${crypto.randomUUID()}`;
    const referenceId = `Reference-${crypto.randomUUID()}`;

    const signingTime = new Date().toISOString();

    // Canonicalize XML (C14N)
    const canonicalizedXml = this.canonicalize(xml);

    // Calculate digest of the document
    const documentDigest = this.calculateDigest(canonicalizedXml);

    // Create SignedProperties for XAdES
    const signedProperties = this.createSignedProperties(
      signedPropertiesId,
      signingTime,
      certInfo,
    );
    const signedPropertiesDigest = this.calculateDigest(
      this.canonicalize(signedProperties),
    );

    // Create SignedInfo
    const signedInfo = this.createSignedInfo(
      referenceId,
      documentDigest,
      signedPropertiesId,
      signedPropertiesDigest,
      keyInfoId,
    );

    // Sign the SignedInfo
    const signatureValue = this.sign(this.canonicalize(signedInfo), certInfo.privateKey);

    // Create KeyInfo
    const keyInfo = this.createKeyInfo(keyInfoId, certInfo);

    // Create complete signature block
    const signatureBlock = this.createSignatureBlock(
      signatureId,
      signedInfo,
      signatureValue,
      keyInfo,
      signedProperties,
      signedPropertiesId,
    );

    // Insert signature into XML
    return this.insertSignature(xml, signatureBlock);
  }

  private canonicalize(xml: string): string {
    // Basic C14N implementation
    // In production, use a proper XML canonicalization library
    return xml
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/>\s+</g, '><')
      .trim();
  }

  private calculateDigest(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('base64');
  }

  private sign(content: string, privateKey: crypto.KeyObject): string {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(content);
    return sign.sign(privateKey, 'base64');
  }

  private createSignedProperties(
    id: string,
    signingTime: string,
    certInfo: CertificateInfo,
  ): string {
    // Calculate certificate digest
    const certDigest = crypto
      .createHash('sha256')
      .update(Buffer.from(certInfo.certificate, 'base64'))
      .digest('base64');

    return `<xades:SignedProperties Id="${id}">
  <xades:SignedSignatureProperties>
    <xades:SigningTime>${signingTime}</xades:SigningTime>
    <xades:SigningCertificate>
      <xades:Cert>
        <xades:CertDigest>
          <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
          <ds:DigestValue>${certDigest}</ds:DigestValue>
        </xades:CertDigest>
        <xades:IssuerSerial>
          <ds:X509IssuerName>${this.escapeXml(certInfo.issuer)}</ds:X509IssuerName>
          <ds:X509SerialNumber>${certInfo.serialNumber}</ds:X509SerialNumber>
        </xades:IssuerSerial>
      </xades:Cert>
    </xades:SigningCertificate>
  </xades:SignedSignatureProperties>
  <xades:SignedDataObjectProperties>
    <xades:DataObjectFormat ObjectReference="#Reference-document">
      <xades:MimeType>text/xml</xades:MimeType>
    </xades:DataObjectFormat>
  </xades:SignedDataObjectProperties>
</xades:SignedProperties>`;
  }

  private createSignedInfo(
    referenceId: string,
    documentDigest: string,
    signedPropertiesId: string,
    signedPropertiesDigest: string,
    keyInfoId: string,
  ): string {
    return `<ds:SignedInfo>
  <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>
  <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
  <ds:Reference Id="Reference-document" URI="">
    <ds:Transforms>
      <ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>
      <ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>
    </ds:Transforms>
    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
    <ds:DigestValue>${documentDigest}</ds:DigestValue>
  </ds:Reference>
  <ds:Reference Id="${referenceId}" URI="#${signedPropertiesId}" Type="http://uri.etsi.org/01903#SignedProperties">
    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
    <ds:DigestValue>${signedPropertiesDigest}</ds:DigestValue>
  </ds:Reference>
  <ds:Reference URI="#${keyInfoId}">
    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
    <ds:DigestValue></ds:DigestValue>
  </ds:Reference>
</ds:SignedInfo>`;
  }

  private createKeyInfo(id: string, certInfo: CertificateInfo): string {
    return `<ds:KeyInfo Id="${id}">
  <ds:X509Data>
    <ds:X509Certificate>${certInfo.certificate}</ds:X509Certificate>
  </ds:X509Data>
</ds:KeyInfo>`;
  }

  private createSignatureBlock(
    signatureId: string,
    signedInfo: string,
    signatureValue: string,
    keyInfo: string,
    signedProperties: string,
    signedPropertiesId: string,
  ): string {
    return `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="${signatureId}">
${signedInfo}
<ds:SignatureValue>${signatureValue}</ds:SignatureValue>
${keyInfo}
<ds:Object>
  <xades:QualifyingProperties Target="#${signatureId}">
    ${signedProperties}
  </xades:QualifyingProperties>
</ds:Object>
</ds:Signature>`;
  }

  private insertSignature(xml: string, signatureBlock: string): string {
    // For FatturaPA, signature should be inserted before closing tag
    // Find the root element closing tag
    const rootCloseMatch = xml.match(/<\/[^>]+>\s*$/);
    if (rootCloseMatch) {
      const insertPosition = xml.lastIndexOf(rootCloseMatch[0]);
      return (
        xml.substring(0, insertPosition) +
        signatureBlock +
        xml.substring(insertPosition)
      );
    }
    // Fallback: append at end (not ideal)
    return xml + signatureBlock;
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
   * Verify XAdES signature
   */
  async verifySignature(signedXml: string): Promise<boolean> {
    try {
      // Extract signature from XML
      const signatureMatch = signedXml.match(
        /<ds:Signature[^>]*>[\s\S]*?<\/ds:Signature>/,
      );
      if (!signatureMatch) {
        this.logger.warn('No signature found in XML');
        return false;
      }

      // Extract certificate from signature
      const certMatch = signedXml.match(
        /<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/,
      );
      if (!certMatch) {
        this.logger.warn('No certificate found in signature');
        return false;
      }

      // Extract signature value
      const sigValueMatch = signedXml.match(
        /<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/,
      );
      if (!sigValueMatch) {
        this.logger.warn('No signature value found');
        return false;
      }

      // Extract SignedInfo for verification
      const signedInfoMatch = signedXml.match(
        /<ds:SignedInfo>[\s\S]*?<\/ds:SignedInfo>/,
      );
      if (!signedInfoMatch) {
        this.logger.warn('No SignedInfo found');
        return false;
      }

      const certPem = `-----BEGIN CERTIFICATE-----\n${certMatch[1]}\n-----END CERTIFICATE-----`;
      const publicKey = crypto.createPublicKey(certPem);

      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(this.canonicalize(signedInfoMatch[0]));

      return verify.verify(publicKey, sigValueMatch[1], 'base64');
    } catch (error) {
      this.logger.error('Signature verification failed:', error);
      return false;
    }
  }
}
