/**
 * Real Postgres: numbering a document freezes its buyer's identifiers, and editing the client afterwards
 * leaves the issued document's snapshot untouched. A linked credit note copies the snapshot of the
 * invoice it corrects, not the client's record at the time the credit note is numbered.
 */
import prisma from '@/prisma/prisma.service';

import { createTestCompany } from '../__tests__/issuable-client';
import { takeDocumentNumber, takeDocumentNumberWithStatusTransition } from '../numbering/sequence';
import { parseFrozenBuyerIdentifiers } from './frozen-buyer-identifiers';

const VALIDATED_AT = new Date('2026-09-01T09:00:00.000Z');

async function createClient(companyId: string) {
  return prisma.client.create({
    data: {
      companyId,
      name: 'Buyer GmbH',
      country: 'Germany',
      countryCode: 'DE',
      partyIdentifiers: {
        create: [
          {
            scheme: 'VAT',
            value: 'DE123456789',
            validationStatus: 'VALID',
            validatedAt: VALIDATED_AT,
            validationSource: 'eu-vies',
          },
          { scheme: 'LEGAL_ID', value: 'HRB 12345' },
        ],
      },
    },
    select: { id: true },
  });
}

async function editClientVat(clientId: string) {
  await prisma.partyIdentifier.update({
    where: { clientId_scheme: { clientId, scheme: 'VAT' } },
    data: {
      value: 'DE999999999',
      validationStatus: 'INVALID',
      validatedAt: new Date(),
      validationSource: 'eu-vies',
    },
  });
}

async function frozenOf(documentId: string) {
  const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
  return parseFrozenBuyerIdentifiers(row.buyerIdentifiers);
}

const FROZEN = [
  {
    scheme: 'LEGAL_ID',
    value: 'HRB 12345',
    validationStatus: null,
    validatedAt: null,
    validationSource: null,
  },
  {
    scheme: 'VAT',
    value: 'DE123456789',
    validationStatus: 'VALID',
    validatedAt: VALIDATED_AT.toISOString(),
    validationSource: 'eu-vies',
  },
];

describe('numbering freezes the buyer identifiers of the document', () => {
  let companyId: string;
  let clientId: string;

  beforeEach(async () => {
    companyId = (await createTestCompany('Frozen buyer identifiers')).id;
    clientId = (await createClient(companyId)).id;
  });

  afterEach(async () => {
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('an invoice keeps the VAT number and its validation verdict as they were when it was numbered', async () => {
    const invoice = await prisma.documentInstance.create({
      data: {
        companyId,
        typeId: 'invoice',
        status: 'draft',
        data: { client: clientId, issueDate: '2026-09-10' },
      },
    });
    expect(await frozenOf(invoice.id)).toBeNull();

    await takeDocumentNumber(companyId, 'invoice', invoice.id, 'INV-{number:4}', new Date('2026-09-10'));
    await editClientVat(clientId);

    expect(await frozenOf(invoice.id)).toEqual(FROZEN);
  });

  it('the status-transition path freezes the same snapshot', async () => {
    const data = { client: clientId, issueDate: '2026-09-10' };
    const invoice = await prisma.documentInstance.create({
      data: { companyId, typeId: 'invoice', status: 'draft', data },
    });

    await takeDocumentNumberWithStatusTransition(
      companyId,
      'invoice',
      invoice.id,
      ['draft'],
      'sending',
      data,
      'INV-{number:4}',
      new Date('2026-09-10'),
    );
    await editClientVat(clientId);

    expect(await frozenOf(invoice.id)).toEqual(FROZEN);
  });

  it("a credit note copies the corrected invoice's snapshot, not the client's current record", async () => {
    const invoice = await prisma.documentInstance.create({
      data: {
        companyId,
        typeId: 'invoice',
        status: 'draft',
        data: { client: clientId, issueDate: '2026-09-10' },
      },
    });
    await takeDocumentNumber(companyId, 'invoice', invoice.id, 'INV-{number:4}', new Date('2026-09-10'));
    await editClientVat(clientId);

    const creditNote = await prisma.documentInstance.create({
      data: {
        companyId,
        typeId: 'credit-note',
        status: 'draft',
        data: { invoice: invoice.id, issueDate: '2026-09-20' },
      },
    });
    await takeDocumentNumber(
      companyId,
      'credit-note',
      creditNote.id,
      'CN-{number:4}',
      new Date('2026-09-20'),
    );

    expect(await frozenOf(creditNote.id)).toEqual(FROZEN);
  });

  it('a document with no buyer freezes nothing', async () => {
    const doc = await prisma.documentInstance.create({
      data: { companyId, typeId: 'credit-note', status: 'draft', data: { issueDate: '2026-09-20' } },
    });
    await takeDocumentNumber(companyId, 'credit-note', doc.id, 'CN-{number:4}', new Date('2026-09-20'));

    const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.number).toBe(1);
    expect(row.buyerIdentifiers).toBeNull();
  });
});
