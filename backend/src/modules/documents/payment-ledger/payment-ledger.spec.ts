/**
 * Real Postgres: the append-only guard is a database trigger, so only a real database proves it.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { recordPayment } from '../settlement/payments';
import { buildPaymentLedgerArchive } from './archive';
import { buildPublisherAttestation } from './attestation';
import { closeElapsedPeriods } from './closures';
import { canonicalPayment, isValidLedgerSignature, sha256Hex } from './ledger-hash';
import { reversePayment } from './reverse';
import { verifyPaymentLedger } from './verify';

let sequence = 0;

async function createCompany(countryCode = 'FR') {
  sequence += 1;
  return prisma.company.create({
    data: {
      name: `Payment Ledger Co ${sequence}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 rue de Test',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      countryCode,
      phone: '+33100000000',
      email: `payment-ledger-${Date.now()}-${sequence}@example.com`,
    },
  });
}

async function createDocument(companyId: string) {
  return prisma.documentInstance.create({ data: { companyId, typeId: 'invoice', data: {} } });
}

function pay(companyId: string, documentId: string, amountMinor: number) {
  return recordPayment({
    companyId,
    documentId,
    amountMinor,
    currency: 'EUR',
    documentAmountMinor: amountMinor,
    method: 'transfer',
    paidAt: new Date('2026-03-01T10:00:00Z'),
  });
}

/** Writes a past-dated, still unsealed payment, as if it had been recorded on that day. */
function insertPastPayment(companyId: string, documentId: string, amountMinor: number, createdAt: string) {
  return prisma.documentPayment.create({
    data: {
      companyId,
      documentId,
      amountMinor,
      currency: 'EUR',
      documentAmountMinor: amountMinor,
      paidAt: new Date(createdAt),
      createdAt: new Date(createdAt),
    },
  });
}

/** Bypasses the trigger the way someone with direct database access could. */
async function tamper(statement: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    await tx.$executeRawUnsafe(statement);
  });
}

const companies: string[] = [];

async function freshLedger() {
  const company = await createCompany();
  companies.push(company.id);
  const document = await createDocument(company.id);
  return { companyId: company.id, documentId: document.id };
}

afterAll(async () => {
  for (const id of companies) await prisma.company.delete({ where: { id } }).catch(() => undefined);
});

describe('payment ledger: sealing and chaining', () => {
  it('seals each payment with a gapless sequence, the previous hash and a valid signature', async () => {
    const { companyId, documentId } = await freshLedger();

    const first = await pay(companyId, documentId, 1000);
    const second = await pay(companyId, documentId, 2500);

    expect(first.ledgerSequence).toBe(1);
    expect(second.ledgerSequence).toBe(2);
    const rows = await prisma.documentPayment.findMany({
      where: { companyId },
      orderBy: { ledgerSequence: 'asc' },
    });
    expect(rows[0].previousHash).toBeNull();
    expect(rows[1].previousHash).toBe(rows[0].hash);
    for (const row of rows) {
      const recomputed = sha256Hex(
        canonicalPayment({
          ...row,
          ledgerSequence: row.ledgerSequence as number,
          conversionRate: row.conversionRate?.toString() ?? null,
        }),
      );
      expect(row.hash).toBe(recomputed);
      expect(isValidLedgerSignature(row.hash as string, row.signature)).toBe(true);
    }

    const verification = await verifyPaymentLedger(companyId);
    expect(verification).toMatchObject({ valid: true, payments: 2, problems: [] });
    expect(verification.lastPaymentHash).toBe(rows[1].hash);
  });

  it('keeps one gapless chain under concurrent writes', async () => {
    const { companyId, documentId } = await freshLedger();

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => pay(companyId, documentId, 100 + i)),
    );

    expect(results.map((r) => r.ledgerSequence).sort((a, b) => (a as number) - (b as number))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect((await verifyPaymentLedger(companyId)).valid).toBe(true);
  });
});

describe('payment ledger: append-only', () => {
  it('refuses to update a sealed payment', async () => {
    const { companyId, documentId } = await freshLedger();
    const payment = await pay(companyId, documentId, 1000);

    await expect(
      prisma.documentPayment.update({ where: { id: payment.id }, data: { amountMinor: 1 } }),
    ).rejects.toThrow(/PAYMENT_LEDGER_APPEND_ONLY/);
    await expect(
      prisma.documentPayment.update({ where: { id: payment.id }, data: { note: 'edited' } }),
    ).rejects.toThrow(/PAYMENT_LEDGER_APPEND_ONLY/);
  });

  it('refuses to reseal a payment once sealed', async () => {
    const { companyId, documentId } = await freshLedger();
    const payment = await pay(companyId, documentId, 1000);

    await expect(
      prisma.documentPayment.update({ where: { id: payment.id }, data: { hash: 'f'.repeat(64) } }),
    ).rejects.toThrow(/PAYMENT_LEDGER_APPEND_ONLY/);
  });

  it('refuses to delete a payment, directly or through its document', async () => {
    const { companyId, documentId } = await freshLedger();
    const payment = await pay(companyId, documentId, 1000);

    await expect(prisma.documentPayment.delete({ where: { id: payment.id } })).rejects.toThrow(
      /PAYMENT_LEDGER_APPEND_ONLY/,
    );
    await expect(prisma.documentInstance.delete({ where: { id: documentId } })).rejects.toThrow();
    expect(await prisma.documentPayment.count({ where: { id: payment.id } })).toBe(1);
  });

  it('refuses to update or delete a closure or an archive', async () => {
    const { companyId, documentId } = await freshLedger();
    await insertPastPayment(companyId, documentId, 500, '2025-06-10T09:00:00Z');
    await buildPaymentLedgerArchive(companyId, 2025, null);
    const closure = await prisma.paymentLedgerClosure.findFirstOrThrow({ where: { companyId } });
    const archive = await prisma.paymentLedgerArchive.findFirstOrThrow({ where: { companyId } });

    await expect(
      prisma.paymentLedgerClosure.update({ where: { id: closure.id }, data: { paymentCount: 9 } }),
    ).rejects.toThrow(/PAYMENT_LEDGER_APPEND_ONLY/);
    await expect(prisma.paymentLedgerClosure.delete({ where: { id: closure.id } })).rejects.toThrow(
      /PAYMENT_LEDGER_APPEND_ONLY/,
    );
    await expect(
      prisma.paymentLedgerArchive.update({ where: { id: archive.id }, data: { content: '{}' } }),
    ).rejects.toThrow(/PAYMENT_LEDGER_APPEND_ONLY/);
    await expect(prisma.paymentLedgerArchive.delete({ where: { id: archive.id } })).rejects.toThrow(
      /PAYMENT_LEDGER_APPEND_ONLY/,
    );
  });

  it('still lets the whole company be deleted, ledger included', async () => {
    const company = await createCompany();
    const document = await createDocument(company.id);
    await pay(company.id, document.id, 1000);
    await insertPastPayment(company.id, document.id, 500, '2025-06-10T09:00:00Z');
    await buildPaymentLedgerArchive(company.id, 2025, null);

    await prisma.company.delete({ where: { id: company.id } });

    expect(await prisma.documentPayment.count({ where: { companyId: company.id } })).toBe(0);
    expect(await prisma.paymentLedgerClosure.count({ where: { companyId: company.id } })).toBe(0);
    expect(await prisma.paymentLedgerArchive.count({ where: { companyId: company.id } })).toBe(0);
  });
});

describe('payment ledger: reversal', () => {
  it('records the exact opposite, pointing at the original, and leaves the original intact', async () => {
    const { companyId, documentId } = await freshLedger();
    const original = await pay(companyId, documentId, 1234);

    const reversal = await reversePayment(companyId, original.id, { reason: 'Entered twice' });

    expect(reversal).toMatchObject({
      documentId,
      amountMinor: -1234,
      documentAmountMinor: -1234,
      currency: 'EUR',
      method: 'transfer',
      note: 'Entered twice',
      reversesPaymentId: original.id,
      ledgerSequence: 2,
    });
    const stored = await prisma.documentPayment.findUniqueOrThrow({ where: { id: original.id } });
    expect(stored.amountMinor).toBe(1234);
    expect((await verifyPaymentLedger(companyId)).valid).toBe(true);
  });

  it('refuses a second reversal, the reversal of a reversal, and a missing reason', async () => {
    const { companyId, documentId } = await freshLedger();
    const original = await pay(companyId, documentId, 1000);

    await expect(reversePayment(companyId, original.id, { reason: '  ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const reversal = await reversePayment(companyId, original.id, { reason: 'Wrong amount' });
    await expect(reversePayment(companyId, original.id, { reason: 'Again' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(reversePayment(companyId, reversal.id, { reason: 'Undo' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('does not reverse another company payment', async () => {
    const a = await freshLedger();
    const b = await freshLedger();
    const payment = await pay(a.companyId, a.documentId, 1000);

    await expect(reversePayment(b.companyId, payment.id, { reason: 'x' })).rejects.toThrow(/not found/i);
  });
});

describe('payment ledger: closures', () => {
  it('closes elapsed days, months and years with cumulative totals, in one signed chain', async () => {
    const { companyId, documentId } = await freshLedger();
    await insertPastPayment(companyId, documentId, 1000, '2025-03-10T09:00:00Z');
    await insertPastPayment(companyId, documentId, 500, '2025-03-10T15:00:00Z');
    await insertPastPayment(companyId, documentId, -200, '2025-04-02T09:00:00Z');
    await pay(companyId, documentId, 99);

    await closeElapsedPeriods(companyId);

    const closures = await prisma.paymentLedgerClosure.findMany({
      where: { companyId },
      orderBy: { sequence: 'asc' },
    });
    const byKind = (kind: string) => closures.filter((c) => c.kind === kind);
    expect(byKind('DAILY').map((c) => [c.periodStart.toISOString(), c.totals, c.perpetualTotals])).toEqual([
      ['2025-03-10T00:00:00.000Z', { EUR: 1500 }, { EUR: 1500 }],
      ['2025-04-02T00:00:00.000Z', { EUR: -200 }, { EUR: 1300 }],
    ]);
    expect(byKind('MONTHLY').map((c) => c.paymentCount)).toEqual([2, 1]);
    expect(byKind('YEARLY')).toHaveLength(1);
    expect(byKind('YEARLY')[0]).toMatchObject({
      paymentCount: 3,
      firstPaymentSequence: 1,
      lastPaymentSequence: 3,
      totals: { EUR: 1300 },
    });
    expect(closures.map((c) => c.sequence)).toEqual(closures.map((_, i) => i + 1));
    closures.forEach((closure, i) => {
      expect(closure.previousHash).toBe(i === 0 ? null : closures[i - 1].hash);
    });

    expect(await closeElapsedPeriods(companyId)).toBe(0);
    expect((await verifyPaymentLedger(companyId)).valid).toBe(true);
  });
});

describe('payment ledger: verification', () => {
  it('reports a payment altered behind the guard', async () => {
    const { companyId, documentId } = await freshLedger();
    await pay(companyId, documentId, 1000);
    const second = await pay(companyId, documentId, 2000);

    await tamper(`UPDATE "DocumentPayment" SET "amountMinor" = 1 WHERE "id" = '${second.id}'`);

    const verification = await verifyPaymentLedger(companyId);
    expect(verification.valid).toBe(false);
    expect(verification.problems).toEqual([
      { chain: 'payments', kind: 'hash-mismatch', recordId: second.id, sequence: 2 },
    ]);
  });

  it('reports a payment removed from the middle of the chain', async () => {
    const { companyId, documentId } = await freshLedger();
    await pay(companyId, documentId, 1000);
    const middle = await pay(companyId, documentId, 2000);
    const last = await pay(companyId, documentId, 3000);

    await tamper(`DELETE FROM "DocumentPayment" WHERE "id" = '${middle.id}'`);

    const kinds = (await verifyPaymentLedger(companyId)).problems.map((p) => [p.recordId, p.kind]);
    expect(kinds).toEqual([
      [last.id, 'sequence-gap'],
      [last.id, 'previous-hash-mismatch'],
    ]);
  });

  it('reports a forged hash whose signature does not match', async () => {
    const { companyId, documentId } = await freshLedger();
    const only = await pay(companyId, documentId, 1000);
    const forged = sha256Hex('forged');

    await tamper(`UPDATE "DocumentPayment" SET "hash" = '${forged}' WHERE "id" = '${only.id}'`);

    const kinds = (await verifyPaymentLedger(companyId)).problems.map((p) => p.kind);
    expect(kinds).toEqual(['hash-mismatch', 'signature-mismatch']);
  });

  it('reports an altered closure', async () => {
    const { companyId, documentId } = await freshLedger();
    await insertPastPayment(companyId, documentId, 1000, '2025-03-10T09:00:00Z');
    await closeElapsedPeriods(companyId);
    const closure = await prisma.paymentLedgerClosure.findFirstOrThrow({
      where: { companyId, kind: 'YEARLY' },
    });

    await tamper(`UPDATE "PaymentLedgerClosure" SET "totals" = '{"EUR": 1}' WHERE "id" = '${closure.id}'`);

    expect((await verifyPaymentLedger(companyId)).problems).toEqual([
      { chain: 'closures', kind: 'hash-mismatch', recordId: closure.id, sequence: closure.sequence },
    ]);
  });
});

describe('payment ledger: archive', () => {
  it('exports a year of payments and closures, with its digest, and keeps a copy', async () => {
    const { companyId, documentId } = await freshLedger();
    await insertPastPayment(companyId, documentId, 1000, '2025-03-10T09:00:00Z');
    await insertPastPayment(companyId, documentId, 700, '2024-12-31T23:00:00Z');

    const archive = await buildPaymentLedgerArchive(companyId, 2025, null);

    expect(archive.fileName).toBe('payment-ledger-2025.json');
    expect(archive.sha256).toBe(sha256Hex(archive.body));
    const parsed = JSON.parse(archive.body);
    expect(parsed).toMatchObject({
      format: 'invoicerr-payment-ledger-archive',
      formatVersion: 1,
      period: { start: '2025-01-01T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' },
      verification: { valid: true },
      notice: { language: 'fr' },
    });
    expect(parsed.payments.map((p: { amountMinor: number }) => p.amountMinor)).toEqual([1000]);
    expect(parsed.closures.map((c: { periodStart: string }) => c.periodStart.slice(0, 4))).toEqual([
      '2025',
      '2025',
      '2025',
    ]);
    const stored = await prisma.paymentLedgerArchive.findFirstOrThrow({ where: { companyId } });
    expect(stored).toMatchObject({ sha256: archive.sha256, content: archive.body });
  });

  it('refuses a year that is not a four-digit year', async () => {
    const { companyId } = await freshLedger();
    await expect(buildPaymentLedgerArchive(companyId, 25, null)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('payment ledger: publisher attestation', () => {
  it('fills the model with the software, the company and the configured publisher', async () => {
    const { companyId } = await freshLedger();
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const previous = { ...process.env };
    process.env.CASH_RECORDING_PUBLISHER_NAME = 'Publisher SAS';
    process.env.CASH_RECORDING_PUBLISHER_REPRESENTATIVE = 'A. Representative';
    process.env.CASH_RECORDING_PUBLISHER_CITY = 'Lyon';
    process.env.CASH_RECORDING_MARKETED_SINCE = '2024';
    try {
      const attestation = await buildPublisherAttestation(companyId, new Date('2026-11-17T12:00:00Z'));

      expect(attestation.missing).toEqual([]);
      expect(attestation.reference).toMatch(/^BOI-LETTRE-000242/);
      expect(attestation.text).toContain('Invoicerr');
      expect(attestation.text).toContain('Publisher SAS');
      expect(attestation.text).toContain(company.name);
      expect(attestation.text).toContain('2026-11-17');
      expect(attestation.text).not.toMatch(/\{[a-zA-Z]+\}/);
    } finally {
      process.env = previous;
    }
  });

  it('leaves an unconfigured publisher field blank and says which', async () => {
    const { companyId } = await freshLedger();
    const previous = { ...process.env };
    delete process.env.CASH_RECORDING_PUBLISHER_NAME;
    try {
      const attestation = await buildPublisherAttestation(companyId);
      expect(attestation.missing).toContain('publisherName');
      expect(attestation.text).toContain('________');
    } finally {
      process.env = previous;
    }
  });

  it('is not offered for a country whose file carries no such obligation', async () => {
    const company = await createCompany('DE');
    companies.push(company.id);
    await expect(buildPublisherAttestation(company.id)).rejects.toThrow(/not|no/i);
  });
});
