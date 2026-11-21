import { BadRequestException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { toPaymentResult } from '../settlement/payments';
import { closeElapsedPeriods } from './closures';
import { cashRecordingSectionFor } from './country-section';
import { sha256Hex } from './ledger-hash';
import { nextPeriodStart } from './periods';
import { verifyPaymentLedger } from './verify';

const PAYMENT_LEDGER_ARCHIVE_FORMAT = 'invoicerr-payment-ledger-archive';

export interface PaymentLedgerArchiveFile {
  fileName: string;
  body: string;
  sha256: string;
}

/**
 * One calendar year (UTC, on the recording date) of payments and closures as a JSON document, with
 * the verification of the whole chain and the country's explanatory notice when it has one. Each
 * generation is kept as generated, with its digest, for as long as the company exists. The ledger
 * rows themselves stay too: an archive is a readable copy, never a reason to delete anything.
 */
export async function buildPaymentLedgerArchive(
  companyId: string,
  year: number,
  generatedBy: string | null,
): Promise<PaymentLedgerArchiveFile> {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new BadRequestException('year must be a four-digit year');
  }
  const periodStart = new Date(Date.UTC(year, 0, 1));
  const periodEnd = nextPeriodStart('YEARLY', periodStart);

  await closeElapsedPeriods(companyId);
  const [payments, closures, verification, section] = await Promise.all([
    prisma.documentPayment.findMany({
      where: { companyId, createdAt: { gte: periodStart, lt: periodEnd } },
      orderBy: { ledgerSequence: 'asc' },
    }),
    prisma.paymentLedgerClosure.findMany({
      where: { companyId, periodStart: { gte: periodStart, lt: periodEnd } },
      orderBy: { sequence: 'asc' },
    }),
    verifyPaymentLedger(companyId),
    cashRecordingSectionFor(companyId),
  ]);
  const generatedAt = new Date();

  const document = {
    format: PAYMENT_LEDGER_ARCHIVE_FORMAT,
    formatVersion: 1,
    companyId,
    period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
    generatedAt: generatedAt.toISOString(),
    notice: section ? { language: section.archive.language, text: section.archive.notice } : null,
    verification,
    payments: payments.map((row) => ({
      ...toPaymentResult(row),
      conversionRate: row.conversionRate?.toString() ?? null,
      companyId: row.companyId,
      previousHash: row.previousHash,
      hash: row.hash,
      signature: row.signature,
    })),
    closures,
  };
  const body = `${JSON.stringify(document, null, 2)}\n`;
  const sha256 = sha256Hex(body);

  await prisma.paymentLedgerArchive.create({
    data: { companyId, periodStart, periodEnd, generatedBy, sha256, content: body, createdAt: generatedAt },
  });
  return { fileName: `payment-ledger-${year}.json`, body, sha256 };
}

export async function listPaymentLedgerArchives(companyId: string) {
  return prisma.paymentLedgerArchive.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      generatedBy: true,
      sha256: true,
      createdAt: true,
    },
  });
}

export async function getPaymentLedgerArchive(
  companyId: string,
  id: string,
): Promise<PaymentLedgerArchiveFile> {
  const row = await prisma.paymentLedgerArchive.findFirst({ where: { id, companyId } });
  if (!row) throw new NotFoundException('Archive not found.');
  return {
    fileName: `payment-ledger-${row.periodStart.getUTCFullYear()}-${row.id}.json`,
    body: row.content,
    sha256: row.sha256,
  };
}
