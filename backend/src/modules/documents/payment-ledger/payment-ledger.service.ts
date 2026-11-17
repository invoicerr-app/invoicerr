import { BadRequestException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { buildPaymentLedgerArchive, getPaymentLedgerArchive, listPaymentLedgerArchives } from './archive';
import { buildPublisherAttestation } from './attestation';
import { closeElapsedPeriods } from './closures';
import { cashRecordingSectionFor } from './country-section';
import { CLOSURE_KINDS, ClosureKind } from './periods';
import { ReversePaymentInput, reversePayment } from './reverse';
import { verifyPaymentLedger } from './verify';

@Injectable()
export class PaymentLedgerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaymentLedgerService.name);

  /** Seals rows recorded before the ledger existed and writes elapsed closures. Not awaited: the
   *  same work also runs lazily on every ledger read, so a slow pass never delays boot. */
  onApplicationBootstrap(): void {
    void this.sealAllCompanies().catch((error) =>
      this.logger.error(`Payment ledger boot pass failed: ${(error as Error).message}`),
    );
  }

  async sealAllCompanies(): Promise<void> {
    const companies = await prisma.documentPayment.findMany({
      distinct: ['companyId'],
      select: { companyId: true },
    });
    for (const { companyId } of companies) await closeElapsedPeriods(companyId);
  }

  async verify(companyId: string) {
    await closeElapsedPeriods(companyId);
    return verifyPaymentLedger(companyId);
  }

  async listClosures(companyId: string, kind?: string) {
    if (kind && !CLOSURE_KINDS.includes(kind as ClosureKind)) {
      throw new BadRequestException(`kind must be one of ${CLOSURE_KINDS.join(', ')}`);
    }
    await closeElapsedPeriods(companyId);
    return prisma.paymentLedgerClosure.findMany({
      where: { companyId, ...(kind ? { kind } : {}) },
      orderBy: { sequence: 'asc' },
    });
  }

  reverse(companyId: string, paymentId: string, input: ReversePaymentInput) {
    return reversePayment(companyId, paymentId, input);
  }

  async obligation(companyId: string) {
    const section = await cashRecordingSectionFor(companyId);
    if (!section) return null;
    return {
      countryCode: section.countryCode,
      obligation: section.obligation,
      exclusions: section.exclusions,
      attestationAvailableFrom: section.attestation.availableFrom,
      attestationModel: section.attestation.model.reference,
    };
  }

  attestation(companyId: string) {
    return buildPublisherAttestation(companyId);
  }

  listArchives(companyId: string) {
    return listPaymentLedgerArchives(companyId);
  }

  generateArchive(companyId: string, year: number, generatedBy: string | null) {
    return buildPaymentLedgerArchive(companyId, year, generatedBy);
  }

  getArchive(companyId: string, id: string) {
    return getPaymentLedgerArchive(companyId, id);
  }
}
