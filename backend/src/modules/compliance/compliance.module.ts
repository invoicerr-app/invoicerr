import { Module } from '@nestjs/common';
import { MailService } from '@/mail/mail.service';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { ConfigRegistry } from './configs';
import { FormatService } from './formats/format.service';
import { FacturXGenerator } from './formats/generators/facturx.generator';
import { FatturaPAGenerator } from './formats/generators/fatturapa.generator';
import { UBLGenerator } from './formats/generators/ubl.generator';
import { CorrectionService } from './services/correction.service';
import { ContextBuilderService } from './services/context-builder.service';
import { HashChainService } from './services/hash-chain.service';
import { NumberingService } from './services/numbering.service';
import { QRCodeService } from './services/qr-code.service';
import { RuleResolverService } from './services/rule-resolver.service';
import { VATEngineService } from './services/vat-engine.service';
import { VIESService } from './services/vies.service';
import { XadesSignatureService } from './services/xades-signature.service';
import { ChorusTransmissionStrategy } from './transmission/strategies/chorus.strategy';
import { EmailTransmissionStrategy } from './transmission/strategies/email.strategy';
import { PeppolTransmissionStrategy } from './transmission/strategies/peppol.strategy';
import { SaftTransmissionStrategy } from './transmission/strategies/saft.strategy';
import { SdITransmissionStrategy } from './transmission/strategies/sdi.strategy';
import { SuperPDPTransmissionStrategy } from './transmission/strategies/superpdp.strategy';
import { VerifactuTransmissionStrategy } from './transmission/strategies/verifactu.strategy';
import { ResilientTransmissionService } from './transmission/resilient-transmission.service';
import { TransmissionService } from './transmission/transmission.service';

@Module({
  controllers: [ComplianceController],
  providers: [
    // Core services
    ComplianceService,
    ConfigRegistry,
    ContextBuilderService,
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
    UBLGenerator,
    FacturXGenerator,
    FatturaPAGenerator,

    // Transmission
    TransmissionService,
    ResilientTransmissionService,
    EmailTransmissionStrategy,
    SuperPDPTransmissionStrategy,
    ChorusTransmissionStrategy,
    PeppolTransmissionStrategy,
    SaftTransmissionStrategy,
    SdITransmissionStrategy,
    VerifactuTransmissionStrategy,

    // Mail
    MailService,
  ],
  exports: [
    ComplianceService,
    ConfigRegistry,
    ContextBuilderService,
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
