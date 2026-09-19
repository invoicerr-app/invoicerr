/**
 * Custom fields — `performSaveDraft` (generic-actions.ts) itself
 * no longer validates a company's custom field definitions: that check moved to
 * `documents.service.ts#runAction` (`company-custom-fields/persistence.ts#applyCompanyCustomFieldsView`),
 * which validates EVERY action's data — "send" included, not merely "save-draft" — against the SAME
 * merged field view the create/edit form renders, before any handler (this one included) ever runs.
 * `documents.service.company-custom-fields.spec.ts` proves THAT gate, end to end, through
 * `runAction`. This file's remaining job is narrower: `performSaveDraft` still persists a
 * `custom:`-prefixed value verbatim, and calling it DIRECTLY (bypassing `runAction`, the same
 * "construct the plain function directly" convention every sibling spec in this module already
 * holds) is deliberately no longer where a required-field check happens — asserted here so a future
 * reader never mistakes this file for evidence that the gate still lives here.
 */
import prisma from '@/prisma/prisma.service';

import { createCompanyCustomField } from '../company-custom-fields/persistence';
import { performSaveDraft } from './generic-actions';

describe('performSaveDraft — company custom fields persist verbatim; validation lives in runAction now', () => {
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

  it("does NOT itself refuse a missing REQUIRED custom field — that gate is runAction's alone now", async () => {
    const result = await performSaveDraft(companyId, 'quote', undefined, { description: 'no cost center' });
    expect(result.changed).toBe(true);

    const row = await prisma.documentInstance.findUnique({ where: { id: result.document.id } });
    expect((row?.data as Record<string, unknown>)['custom:cost_center']).toBeUndefined();
  });

  it('persists a prefixed custom field value verbatim when the caller supplies one', async () => {
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
