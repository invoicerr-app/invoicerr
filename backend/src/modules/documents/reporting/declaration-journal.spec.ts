/**
 * The declaration journal against a REAL Postgres unique index: a provider that reports `SUBMITTED`
 * once for the invoice and once per payment must keep every one of those rows. A stateful mock cannot
 * prove this, since the bug lived in the index itself (`createMany({ skipDuplicates: true })` silently
 * dropped every payment declaration after the first).
 */
import prisma from '@/prisma/prisma.service';

import { createAuthorityEvents, journalSyntheticEvent } from '../conformity/authority-events.persistence';
import { FRENCH_PA_PROVIDER_ID } from './providers/fr-pa-declaration-provider';
import { declarationSubjectKey, REPORT_FAILED_STATUS_CODE } from './report-job';

function submitted(reference: string) {
  return { statusCode: 'SUBMITTED', statusText: `Recorded as ${reference}`, observedAt: new Date() };
}

describe('declaration journal - one row per declared subject', () => {
  let companyId: string;
  let documentId: string;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Declaration Journal Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'Nowhereland',
        phone: '+33100000000',
        email: `declaration-journal-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;
  });

  beforeEach(async () => {
    const invoice = await prisma.documentInstance.create({
      data: { companyId, typeId: 'invoice', status: 'sent', displayNumber: 'INV-JOURNAL', data: {} },
    });
    documentId = invoice.id;
  });

  afterAll(async () => {
    await prisma.documentAuthorityEvent.deleteMany({ where: { companyId } });
    await prisma.documentInstance.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  async function journal(reference: string, paymentId?: string): Promise<number> {
    return createAuthorityEvents(
      companyId,
      documentId,
      FRENCH_PA_PROVIDER_ID,
      [submitted(reference)],
      declarationSubjectKey(paymentId),
    );
  }

  async function rows() {
    return prisma.documentAuthorityEvent.findMany({
      where: { companyId, documentId, providerId: FRENCH_PA_PROVIDER_ID },
      orderBy: { createdAt: 'asc' },
    });
  }

  it('keeps the send declaration and the payment declaration of the same invoice', async () => {
    expect(await journal('tx-1')).toBe(1);
    expect(await journal('pay-ref-1', 'payment-1')).toBe(1);

    const journaled = await rows();
    expect(journaled.map((row) => [row.statusCode, row.subjectKey])).toEqual([
      ['SUBMITTED', ''],
      ['SUBMITTED', 'payment-1'],
    ]);
  });

  it('keeps one row per partial payment, and still dedups a replay of the same payment', async () => {
    expect(await journal('tx-1')).toBe(1);
    expect(await journal('pay-ref-1', 'payment-1')).toBe(1);
    expect(await journal('pay-ref-2', 'payment-2')).toBe(1);
    expect(await journal('pay-ref-2-replayed', 'payment-2')).toBe(0);
    expect(await journal('tx-1-replayed')).toBe(0);

    const journaled = await rows();
    expect(journaled.map((row) => row.subjectKey)).toEqual(['', 'payment-1', 'payment-2']);
    expect(journaled.every((row) => row.statusCode === 'SUBMITTED')).toBe(true);
  });

  it('journals a terminal failure per payment, not once per invoice', async () => {
    const fail = (paymentId: string) =>
      journalSyntheticEvent(
        companyId,
        documentId,
        FRENCH_PA_PROVIDER_ID,
        REPORT_FAILED_STATUS_CODE,
        'platform unreachable',
        undefined,
        declarationSubjectKey(paymentId),
      );

    expect(await fail('payment-1')).toBe(1);
    expect(await fail('payment-2')).toBe(1);
    expect(await fail('payment-2')).toBe(0);
    expect((await rows()).map((row) => row.subjectKey)).toEqual(['payment-1', 'payment-2']);
  });
});
