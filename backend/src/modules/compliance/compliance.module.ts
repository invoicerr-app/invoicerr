import { Module } from '@nestjs/common';
import { MailService } from '@/mail/mail.service';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { ContextBuilderService } from './services/context-builder.service';
import { RuleResolverService } from './services/rule-resolver.service';
import { VATEngineService } from './services/vat-engine.service';
import { VIESService } from './services/vies.service';
import { ChorusTransmissionStrategy } from './transmission/strategies/chorus.strategy';
import { EmailTransmissionStrategy } from './transmission/strategies/email.strategy';
import { SuperPDPTransmissionStrategy } from './transmission/strategies/superpdp.strategy';
import { TransmissionService } from './transmission/transmission.service';

@Module({
  controllers: [ComplianceController],
  providers: [
    ComplianceService,
    ContextBuilderService,
    RuleResolverService,
    VATEngineService,
    VIESService,
    TransmissionService,
    EmailTransmissionStrategy,
    SuperPDPTransmissionStrategy,
    ChorusTransmissionStrategy,
    MailService,
  ],
  exports: [ComplianceService, VATEngineService, TransmissionService],
})
export class ComplianceModule {}
