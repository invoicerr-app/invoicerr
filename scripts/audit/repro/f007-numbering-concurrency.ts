/**
 * REPRODUCTION — F-007 / F-008 (audit/compliance-truth, phase 1 point 3)
 *
 * Two questions about the gapless sequence:
 *   A. N DIFFERENT drafts issued concurrently — does the series stay gapless and duplicate-free?
 *   B. the SAME draft issued concurrently N times — `issueInvoice()` reads the invoice and checks
 *      `invoice.number !== null` OUTSIDE the transaction (invoices.service.ts:436-447), then
 *      allocates inside it. Does that check hold under concurrency?
 *
 * This does NOT invoke InvoicesService (it needs the whole Nest DI graph). It replicates the exact
 * concurrency-relevant shape of issueInvoice():
 *     findFirst (no tx) → guard on status/number → $transaction( nextNumber + invoice.update )
 * using the REAL NumberingService, so the SQL that allocates is the production SQL.
 *
 * Unlike the other repros this one must COMMIT (a rolled-back transaction cannot race with itself).
 * It therefore creates its own throwaway company, tagged AUDIT-CONCURRENCY-<pid>, and deletes
 * everything it created in a finally block. It touches no pre-existing row.
 *
 * Run: cd backend && npx dotenv -e .env.test -- npx tsx ../scripts/audit/repro/f007-numbering-concurrency.ts
 */
import prisma from '../../../backend/src/prisma/prisma.service';
import { NumberingService } from '../../../backend/src/utils/numbering';
import type { Prisma } from '../../../backend/prisma/generated/prisma/client';

const line = (s = '') => process.stdout.write(`${s}\n`);
const TAG = `AUDIT-CONCURRENCY-${process.pid}`;
const numbering = new NumberingService();
const CONCURRENCY = 8;

/** The concurrency-relevant shape of InvoicesService.issueInvoice(). */
async function issueLikeTheService(invoiceId: string, companyId: string) {
  // 1. read + guard, OUTSIDE any transaction — exactly as invoices.service.ts does
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId } });
  if (!invoice) throw new Error('not found');
  if (invoice.status !== 'DRAFT') throw new Error(`status ${invoice.status}`);
  if (invoice.number !== null) throw new Error('already numbered');

  // 2. allocate + update, INSIDE one transaction
  const issueDate = new Date();
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const { counter, rawNumber } = await numbering.nextNumber(tx, companyId, 'invoice', issueDate);
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { number: counter, rawNumber, issuedAt: issueDate, status: 'ISSUED' },
    });
    return { counter, rawNumber };
  });
}

async function main() {
  line(`base cible : ${(process.env.DATABASE_URL ?? '(non définie)').replace(/:[^:@]*@/, ':***@')}`);
  line(`marqueur   : ${TAG} (tout ce qui est créé ici est supprimé à la fin)`);
  line();

  const pdfConfig = await prisma.pDFConfig.create({ data: {} });
  const company = await prisma.company.create({
    data: {
      name: TAG,
      foundedAt: new Date('2020-01-01'),
      address: '1 rue de l Audit',
      postalCode: '75001',
      city: 'Paris',
      country: 'FR',
      phone: '+33100000000',
      email: `${TAG.toLowerCase()}@example.invalid`,
      pDFConfigId: pdfConfig.id,
    },
  });
  const client = await prisma.client.create({
    data: {
      companyId: company.id,
      name: `${TAG} client`,
      address: '2 rue du Client',
      postalCode: '75002',
      city: 'Paris',
      country: 'FR',
    },
  });

  const draft = (n: number) =>
    prisma.invoice.create({
      data: {
        clientId: client.id,
        companyId: company.id,
        dueDate: new Date('2026-09-30'),
        totalHT: n,
        totalVAT: 0,
        totalTTC: n,
        currency: 'EUR' as const,
        status: 'DRAFT' as const,
      },
    });

  try {
    // ── A. N distinct drafts, issued concurrently ────────────────────────────────────
    line(`== A. ${CONCURRENCY} brouillons DISTINCTS émis en parallèle ==`);
    const drafts = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => draft(i + 1)));
    const resultsA = await Promise.allSettled(
      drafts.map((d) => issueLikeTheService(d.id, company.id)),
    );
    const okA = resultsA.filter((r) => r.status === 'fulfilled').length;
    const numbersA = (
      await prisma.invoice.findMany({
        where: { companyId: company.id, number: { not: null } },
        select: { number: true },
        orderBy: { number: 'asc' },
      })
    ).map((i) => i.number!);
    const uniqueA = new Set(numbersA);
    const expected = Array.from({ length: numbersA.length }, (_, i) => numbersA[0] + i);
    const gapless = JSON.stringify(numbersA) === JSON.stringify(expected);
    line(`   émissions réussies : ${okA}/${CONCURRENCY}`);
    line(`   numéros attribués  : ${JSON.stringify(numbersA)}`);
    line(`   doublons           : ${numbersA.length - uniqueA.size}`);
    line(`   séquence sans trou : ${gapless ? 'OUI' : 'NON'}`);
    const counterA = await prisma.numberSeries.findFirst({
      where: { companyId: company.id, docType: 'invoice' },
      select: { counter: true },
    });
    line(`   compteur NumberSeries : ${counterA?.counter} — factures numérotées : ${numbersA.length}`);
    line();

    // ── B. the SAME draft, issued concurrently ──────────────────────────────────────
    line(`== B. LE MÊME brouillon émis ${CONCURRENCY} fois en parallèle ==`);
    line('   (garde `invoice.number !== null` évaluée hors transaction — invoices.service.ts:447)');
    const single = await draft(999);
    const counterBefore = (
      await prisma.numberSeries.findFirst({
        where: { companyId: company.id, docType: 'invoice' },
        select: { counter: true },
      })
    )?.counter;
    const resultsB = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () => issueLikeTheService(single.id, company.id)),
    );
    const okB = resultsB.filter((r) => r.status === 'fulfilled');
    const counterAfter = (
      await prisma.numberSeries.findFirst({
        where: { companyId: company.id, docType: 'invoice' },
        select: { counter: true },
      })
    )?.counter;
    const finalRow = await prisma.invoice.findUnique({
      where: { id: single.id },
      select: { number: true, rawNumber: true },
    });
    const consumed = (counterAfter ?? 0) - (counterBefore ?? 0);
    line(`   appels ayant franchi la garde et alloué un numéro : ${okB.length}/${CONCURRENCY}`);
    line(
      `   numéros alloués : ${JSON.stringify(okB.map((r) => (r as PromiseFulfilledResult<{ counter: number }>).value.counter))}`,
    );
    line(`   compteur consommé : ${counterBefore} → ${counterAfter} (soit ${consumed} valeur(s))`);
    line(`   numéro finalement porté par la facture : ${finalRow?.number} (${finalRow?.rawNumber})`);
    line(`   valeurs de séquence consommées puis perdues : ${Math.max(0, consumed - 1)}`);
    line();

    // ── C. what the series looks like afterwards ────────────────────────────────────
    line('== C. état final de la série ==');
    const all = (
      await prisma.invoice.findMany({
        where: { companyId: company.id, number: { not: null } },
        select: { number: true },
        orderBy: { number: 'asc' },
      })
    ).map((i) => i.number!);
    const counterFinal = (
      await prisma.numberSeries.findFirst({
        where: { companyId: company.id, docType: 'invoice' },
        select: { counter: true },
      })
    )?.counter;
    const missing = Array.from({ length: (counterFinal ?? 0) - all[0] + 1 }, (_, i) => all[0] + i).filter(
      (n) => !all.includes(n),
    );
    line(`   numéros portés par une facture : ${JSON.stringify(all)}`);
    line(`   compteur de la série           : ${counterFinal}`);
    line(`   NUMÉROS MANQUANTS DANS LA SÉRIE : ${JSON.stringify(missing)}`);
  } finally {
    // Remove every row this script created — nothing pre-existing is touched.
    await prisma.invoice.deleteMany({ where: { companyId: company.id } });
    await prisma.numberSeries.deleteMany({ where: { companyId: company.id } });
    await prisma.client.deleteMany({ where: { companyId: company.id } });
    await prisma.company.deleteMany({ where: { id: company.id } });
    await prisma.pDFConfig.deleteMany({ where: { id: pdfConfig.id } });
    line();
    line(`— nettoyage : toutes les lignes ${TAG} ont été supprimées —`);
    await prisma.$disconnect();
  }
}

void main();
