/**
 * TODO_FEATURES.md rank 15 ("champs personnalisés") — proves the REAL, live integration point named
 * in `performSaveDraft`'s own header: a company custom field's own validation actually runs on the
 * generic "save-draft" write path every document type shares, not merely in isolation
 * (company-custom-fields/persistence.spec.ts already covers the resolver/validator on their own).
 * Real Prisma, same "construct the plain function directly" convention every sibling spec in this
 * module already holds — `performSaveDraft` needs no NestJS DI at all.
 */
import prisma from '@/prisma/prisma.service';

import { createCompanyCustomField } from '../company-custom-fields/persistence';
import { performSaveDraft } from './generic-actions';

describe('performSaveDraft — company custom field validation', () => {
  let companyId: string;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Save Draft Custom Fields Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000000',
        email: `save-draft-custom-fields-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;

    await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      documentTypeId: 'quote',
      label: 'Cost Center',
      kind: 'text',
      required: true,
    });
  });

  afterAll(async () => {
    await prisma.documentInstance.deleteMany({ where: { companyId } });
    await prisma.companyCustomField.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('refuses a save-draft that omits a REQUIRED custom field, before anything is persisted', async () => {
    await expect(
      performSaveDraft(companyId, 'quote', undefined, { description: 'no cost center' }),
    ).rejects.toThrow(/Invalid custom field data/);

    const rows = await prisma.documentInstance.findMany({ where: { companyId, typeId: 'quote' } });
    expect(rows).toHaveLength(0);
  });

  it('accepts and persists a save-draft that carries the prefixed custom field value', async () => {
    const result = await performSaveDraft(companyId, 'quote', undefined, {
      description: 'has a cost center',
      'custom:cost_center': 'CC-007',
    });

    const row = await prisma.documentInstance.findUnique({ where: { id: result.document.id } });
    expect((row?.data as Record<string, unknown>)['custom:cost_center']).toBe('CC-007');
  });

  it('a document type this company defined NO custom field for is entirely unaffected', async () => {
    const result = await performSaveDraft(companyId, 'expense', undefined, { description: 'plain expense' });
    const row = await prisma.documentInstance.findUnique({ where: { id: result.document.id } });
    expect(row?.status).toBe('draft');
  });
});
