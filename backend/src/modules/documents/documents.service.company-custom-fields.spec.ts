import { BadRequestException } from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerQuoteActions } from './actions/quote-actions';
import { createCompanyCustomField, archiveCompanyCustomField } from './company-custom-fields/persistence';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { buildQuoteDescriptor } from './descriptors/quote.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as persistence from './persistence';
import prisma from '@/prisma/prisma.service';
import { EntityReferenceRegistry } from './references/reference-registry';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
// Country policy/resolution — proven for real elsewhere (country-policy/country-policy.spec.ts,
// documents.service.country-policy.spec.ts); mocked wholesale here for the same reason
// documents.service.country-fields.spec.ts and documents.service.spec.ts already mock it: this file
// is about wiring COMPANY CUSTOM FIELDS into describeTypeForCompany/runAction, not country policy.
jest.mock('./country-policy/country-policy');

/**
 * Custom fields ("champs personnalisés") — proves `DocumentsService` actually composes a
 * company's own custom field DEFINITIONS onto the field view BOTH `describeTypeForCompany` (the
 * create/edit FORM) and `runAction` (what actually gets VALIDATED) use, right after the country field
 * overlay — the field-level analogue of what documents.service.country-fields.spec.ts already proves
 * for the country overlay itself. Real Prisma for `company-custom-fields/` (same "construct the
 * plain persistence layer directly" convention that module's own spec holds) — everything document
 * PERSISTENCE-shaped stays mocked via `./persistence`, so this never touches a real DocumentInstance
 * row.
 */
async function makeCompany(suffix: string) {
  return prisma.company.create({
    data: {
      name: `Company Custom Fields Wiring Co ${suffix}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 rue de Test',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+33100000000',
      email: `documents-service-custom-fields-${suffix}-${Date.now()}@example.com`,
    },
  });
}

function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const clientsService = { getClientById: jest.fn().mockResolvedValue(null) };
  const mailService = {
    sendForCompany: jest.fn().mockResolvedValue({ message: 'Email sent successfully' }),
  };
  const referenceRegistry = new EntityReferenceRegistry();
  const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };

  const actionRegistry = new ActionRegistry();
  registerQuoteActions(actionRegistry, {
    clientsService: clientsService as never,
    mailService: mailService as never,
    typeRegistry,
    referenceRegistry,
    queueDispatcher,
  });

  const transportRegistry = new TransportRegistry();

  const service = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    new ActionExtensionRegistry(),
    referenceRegistry,
    transportRegistry,
    new ContributionRegistry(),
  );
  return { service, mailService, queueDispatcher };
}

const validQuoteData = {
  client: 'client-1',
  issueDate: '2026-01-01',
  currency: 'EUR',
  lines: [{ description: 'Widget', quantity: 2, unitPrice: 9.9 }],
};

describe('DocumentsService — wiring company custom fields into the quote', () => {
  let companyId: string;

  beforeAll(async () => {
    const company = await makeCompany('a');
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
    await prisma.companyCustomField.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue(undefined);
  });
  afterEach(() => jest.resetAllMocks());

  describe('describeTypeForCompany — the FORM view', () => {
    it('an ACTIVE custom field definition shows up as a real, required field', async () => {
      (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
      const descriptor = await buildService().service.describeTypeForCompany(companyId, 'quote');

      expect(descriptor.fields.find((f) => f.key === 'custom:cost_center')).toMatchObject({
        kind: 'text',
        label: 'Cost Center',
        required: true,
      });
      // The native fields are untouched, not replaced.
      expect(descriptor.fields.find((f) => f.key === 'client')).toBeDefined();
    });

    it('a company with NO custom field definitions for this type is byte-for-byte unaffected', async () => {
      const other = await makeCompany('b');
      (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });

      const descriptor = await buildService().service.describeTypeForCompany(other.id, 'quote');
      expect(descriptor.fields.some((f) => f.key.startsWith('custom:'))).toBe(false);

      await prisma.company.delete({ where: { id: other.id } }).catch(() => undefined);
    });

    it('an ARCHIVED definition never appears on the form view, even though it was created REQUIRED', async () => {
      const archivable = await createCompanyCustomField(companyId, {
        target: 'DOCUMENT',
        documentTypeId: 'quote',
        label: 'Soon Archived',
        kind: 'text',
        required: true,
      });
      await archiveCompanyCustomField(companyId, archivable.id);

      const descriptor = await buildService().service.describeTypeForCompany(companyId, 'quote');
      expect(descriptor.fields.find((f) => f.key === `custom:${archivable.key}`)).toBeUndefined();
    });
  });

  describe('runAction — the SAME view is what actually gets validated, "send" included', () => {
    it('"save-draft": a required custom field left empty is refused with the SAME error shape a native field gets', async () => {
      const { service } = buildService();

      await expect(
        service.runAction(companyId, 'quote', 'save-draft', {
          data: { ...validQuoteData },
        }),
      ).rejects.toMatchObject({
        response: {
          message: 'Invalid document data',
          errors: expect.arrayContaining([
            expect.objectContaining({ key: 'custom:cost_center', message: '"Cost Center" is required.' }),
          ]),
        },
      });
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });

    it('"save-draft": filling the custom field persists it, prefixed, alongside the native data', async () => {
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: { ...validQuoteData, 'custom:cost_center': 'CC-42' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      const result = await service.runAction(companyId, 'quote', 'save-draft', {
        data: { ...validQuoteData, 'custom:cost_center': 'CC-42' },
      });

      expect(result.changed).toBe(true);
      expect(persistence.upsertDocument).toHaveBeenCalledWith(
        companyId,
        'quote',
        undefined,
        'draft',
        expect.objectContaining({ 'custom:cost_center': 'CC-42' }),
      );
    });

    it('"send": a required custom field left empty is refused BEFORE the handler ever runs — no email, no enqueue', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: validQuoteData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service, mailService, queueDispatcher } = buildService();

      await expect(
        service.runAction(companyId, 'quote', 'send', {
          documentId: 'doc-1',
          data: { ...validQuoteData },
          params: { recipient: 'client@example.com' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mailService.sendForCompany).not.toHaveBeenCalled();
      expect(queueDispatcher.enqueueAction).not.toHaveBeenCalled();
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });

    it('"send": filling the custom field lets phase 1 (persist "sending" + enqueue) proceed normally', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: validQuoteData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: { ...validQuoteData, 'custom:cost_center': 'CC-42' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service, mailService, queueDispatcher } = buildService();
      const result = await service.runAction(companyId, 'quote', 'send', {
        documentId: 'doc-1',
        data: { ...validQuoteData, 'custom:cost_center': 'CC-42' },
        params: { recipient: 'client@example.com' },
      });

      expect(result.changed).toBe(true);
      expect(mailService.sendForCompany).not.toHaveBeenCalled(); // still async phase 1 — see async-send.ts
      expect(queueDispatcher.enqueueAction).toHaveBeenCalled();
    });

    it('an ARCHIVED definition is never required again — "send" succeeds without it even though it once was', async () => {
      const archivable = await createCompanyCustomField(companyId, {
        target: 'DOCUMENT',
        documentTypeId: 'quote',
        label: 'Once Required',
        kind: 'text',
        required: true,
      });
      await archiveCompanyCustomField(companyId, archivable.id);

      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: validQuoteData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: { ...validQuoteData, 'custom:cost_center': 'CC-42' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      const result = await service.runAction(companyId, 'quote', 'send', {
        documentId: 'doc-1',
        // "Cost Center" (still active) is filled; "Once Required" (now archived) is deliberately
        // absent — must NOT block, unlike before it was archived.
        data: { ...validQuoteData, 'custom:cost_center': 'CC-42' },
        params: { recipient: 'client@example.com' },
      });

      expect(result.changed).toBe(true);
    });
  });
});
