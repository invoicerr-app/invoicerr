import { Module } from '@nestjs/common';
import { MailService } from '@/mail/mail.service';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { ConfigRegistry } from './configs';
import { DocumentService } from './documents/document.service';
import { FormatService } from './formats/format.service';
import { ComplianceSettingsService } from './services/compliance-settings.service';
import { ContextBuilderService } from './services/context-builder.service';
import { CorrectionService } from './services/correction.service';
import { HashChainService } from './services/hash-chain.service';
import { NumberingService } from './services/numbering.service';
import { QRCodeService } from './services/qr-code.service';
import { RuleResolverService } from './services/rule-resolver.service';
import { VATEngineService } from './services/vat-engine.service';
import { VIESService } from './services/vies.service';
import { XadesSignatureService } from './services/xades-signature.service';
import { ResilientTransmissionService } from './transmission/resilient-transmission.service';
import { EmailTransmissionStrategy } from './transmission/strategies/email.strategy';
import { TransmissionService } from './transmission/transmission.service';

/**
 * ComplianceModule - Complete compliance features for invoicing
 *
 * Features:
 * - Country configurations (FR, DE, IT, ES, PT, BE)
 * - VAT calculation and validation
 * - E-invoice format generation (UBL, Factur-X, FatturaPa)
 * - Transmission strategies (Chorus, SDI, Peppol, Verifactu, SAF-T, Email)
 * - Hash chain, QR codes, numbering, corrections
 */
@Module({
  controllers: [ComplianceController],
  providers: [
    // Core services
    ComplianceService,
    ComplianceSettingsService,
    ConfigRegistry,
    ContextBuilderService,
    DocumentService,
    RuleResolverService,

    // VAT and calculation
    VATEngineService,
    VIESService,

    // Numbering and hash chain
    NumberingService,
    HashChainService,

    // QR code and correction
    QRCodeService,
    CorrectionService,

    // Signature
    XadesSignatureService,

    // Format generators
    FormatService,

    // Transmission
    TransmissionService,
    ResilientTransmissionService,
    EmailTransmissionStrategy,

    // Mail
    MailService,
  ],
  exports: [
    ComplianceService,
    ComplianceSettingsService,
    ConfigRegistry,
    ContextBuilderService,
    DocumentService,
    RuleResolverService,
    VATEngineService,
    VIESService,
    NumberingService,
    HashChainService,
    QRCodeService,
    CorrectionService,
    TransmissionService,
    ResilientTransmissionService,
    XadesSignatureService,
    FormatService,
  ],
})
export class ComplianceModule {}
