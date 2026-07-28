import { Module } from '@nestjs/common';
import { SigningCertificatesService } from './signing-certificates.service';

/**
 * Signing certificates module — per-company encrypted PFX store.
 * Cycle-safe: only imports PrismaService (injected via the global PrismaModule).
 * ComplianceModule imports this module and injects SigningCertificatesService
 * as the live SigningCredentialsPort.
 */
@Module({
  providers: [SigningCertificatesService],
  exports: [SigningCertificatesService],
})
export class SigningCertificatesModule {}
