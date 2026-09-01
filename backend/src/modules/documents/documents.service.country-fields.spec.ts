import { BadRequestException } from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerInvoiceActions } from './actions/invoice-actions';
import { ContributionRegistry } from './contributions/contribution-registry';
import { CountryFieldOverlayCatalog } from './country-fields/registry';
import { CountryFieldOverlayFile } from './country-fields/schema';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import { TransportRegistry } from './transports/transport-registry';
import { VatRateCatalog } from './vat-rates/registry';
import { CountryVatRatesFile } from './vat-rates/schema';
import * as b2gRouting from './b2g-routing/b2g-routing';

jest.mock('./persistence');
// See documents.service.spec.ts's own comment on this mock — the real decision code (country
// resolution, action policy) is proven elsewhere. This file's own job is: does DocumentsService
// actually WIRE country-fields/ + vat-rates/ into describeTypeForCompany and runAction — the field
// analogue of what documents.service.country-policy.spec.ts already proves for actions.
jest.mock('./country-policy/country-policy');
// B2G routing's own field-hint bridge (`applyB2gDocumentFieldHints`) — mocked wholesale, same
// reason as `country-policy` above (reaches Prisma directly). Defaulted to `applies: false` in the
// new describe block below so every OTHER test in this file (none of which ever passes a `clientId`)
// keeps meaning exactly what it always did.
jest.mock('./b2g-routing/b2g-routing');

/**
 * A SYNTHETIC field overlay, injected directly into this test's own DocumentsService instance — NOT
 * the real shipped `country-fields/data/fr.json` (which now ships one real `add` — `supplyType` on
 * `invoice.lines`, for BT-23; see that file's own header). This exercises all THREE operations
 * (`remove`/`modify`/`add`) for real, end to end, on a FIXTURE independent of whatever the real file
 * happens to contain: this suite's own job is proving `DocumentsService` WIRES the mechanism, not
 * re-asserting the real file's own content (that is `country-fields/data/all.spec.ts`'s job).
 */
const FR_OVERLAY: CountryFieldOverlayFile = {
  countryCode: 'FR',
  overlays: [
    {
      typeId: 'invoice',
      operations: [
        { op: 'remove', path: '', key: 'dueDate' },
        { op: 'modify', path: '', key: 'notes', patch: { required: true } },
        { op: 'add', path: '', field: { key: 'siren', kind: 'text', label: 'SIREN', required: true } },
      ],
    },
  ],
};

const FR_VAT: CountryVatRatesFile = {
  countryCode: 'FR',
  rates: [
    {
      id: 'fr-standard',
      rate: 20,
      label: 'Taux normal',
      category: 'STANDARD',
      provenance: { kind: 'unverified', resolutionNote: 'test fixture' },
    },
  ],
};

function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const transportRegistry = new TransportRegistry();
  const actionRegistry = new ActionRegistry();
  registerInvoiceActions(actionRegistry, {
    transportRegistry,
    queueDispatcher: { enqueueAction: jest.fn() },
  });

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    transportRegistry,
    new ContributionRegistry(),
    new CountryFieldOverlayCatalog([FR_OVERLAY]),
    new VatRateCatalog([FR_VAT]),
  );
}

const baseLine = { description: 'Widget', quantity: 2, unit: 'unit', unitPrice: 9.9, vatRate: '20' };

describe('DocumentsService — wiring the country field overlay + VAT rate catalog into the invoice', () => {
  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
  });
  afterEach(() => jest.resetAllMocks());

  describe('describeTypeForCompany — the field-level view', () => {
    it('a country WITH an overlay: add/modify/remove all show up, and the VAT catalog fills the line’s options', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');

      const descriptor = await buildService().describeTypeForCompany('company-1', 'invoice');

      expect(descriptor.fields.find((f) => f.key === 'dueDate')).toBeUndefined(); // removed
      expect(descriptor.fields.find((f) => f.key === 'notes')?.required).toBe(true); // modified
      expect(descriptor.fields.find((f) => f.key === 'siren')).toMatchObject({
        kind: 'text',
        required: true,
      }); // added

      const vatField = descriptor.fields
        .find((f) => f.key === 'lines')
        ?.fields?.find((f) => f.key === 'vatRate');
      expect(vatField?.options).toEqual([{ value: '20', label: '20% — Taux normal' }]);
    });

    it('a country with NO overlay and NO known catalog gets the trunk intact, and an honest notice on the VAT field', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('DE');

      const descriptor = await buildService().describeTypeForCompany('company-1', 'invoice');

      expect(descriptor.fields.find((f) => f.key === 'dueDate')?.required).toBe(true);
      expect(descriptor.fields.find((f) => f.key === 'notes')?.required).toBe(false);
      expect(descriptor.fields.find((f) => f.key === 'siren')).toBeUndefined();

      const vatField = descriptor.fields
        .find((f) => f.key === 'lines')
        ?.fields?.find((f) => f.key === 'vatRate');
      expect(vatField?.options).toEqual([]);
      expect(vatField?.helpText).toMatch(/No known VAT rate list/);
    });
  });

  describe('runAction — the SAME view is what actually gets validated, not merely displayed', () => {
    const frData = {
      client: 'client-1',
      issueDate: '2026-01-01',
      currency: 'EUR',
      notes: 'Mandatory for FR in this fixture',
      siren: '123456789',
      lines: [baseLine],
    };

    it('FR: accepts a draft with NO dueDate (removed) but WITH notes and siren (added/modified as required)', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: frData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await buildService().runAction('company-1', 'invoice', 'save-draft', { data: frData });
      expect(result.changed).toBe(true);
    });

    it('FR: rejects a draft missing "notes" — the overlay MODIFIED it to required', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
      const { notes: _omit, ...withoutNotes } = frData;

      await expect(
        buildService().runAction('company-1', 'invoice', 'save-draft', { data: withoutNotes }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('FR: rejects a draft missing "siren" — the field the overlay ADDED', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
      const { siren: _omit, ...withoutSiren } = frData;

      await expect(
        buildService().runAction('company-1', 'invoice', 'save-draft', { data: withoutSiren }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('DE (no overlay): a draft with no dueDate is REJECTED — the trunk’s own requiredness holds when nothing overlays it', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('DE');
      const { siren: _siren, ...withoutSiren } = frData; // 'siren' is not even a DE field — must not be required there
      void _siren;

      await expect(
        buildService().runAction('company-1', 'invoice', 'save-draft', { data: withoutSiren }),
      ).rejects.toMatchObject({
        response: { errors: expect.arrayContaining([expect.objectContaining({ key: 'dueDate' })]) },
      });
    });

    it('DE (no overlay): a draft with a due date and no "notes"/"siren" is accepted — those never existed for DE', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('DE');
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const deData = {
        client: 'client-1',
        issueDate: '2026-01-01',
        dueDate: '2026-01-31',
        currency: 'EUR',
        lines: [baseLine],
      };

      const result = await buildService().runAction('company-1', 'invoice', 'save-draft', { data: deData });
      expect(result.changed).toBe(true);
    });

    it('an UNKNOWN VAT catalog does not block the line — allowCustomValue is the escape hatch', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('DE');
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const deData = {
        client: 'client-1',
        issueDate: '2026-01-01',
        dueDate: '2026-01-31',
        currency: 'EUR',
        lines: [{ ...baseLine, vatRate: 'anything-goes-with-no-known-catalog' }],
      };

      const result = await buildService().runAction('company-1', 'invoice', 'save-draft', { data: deData });
      expect(result.changed).toBe(true);
    });

    it('a KNOWN VAT catalog DOES block a rate outside its list — a scripted client cannot bypass a real one', async () => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
      const dataWithBadRate = { ...frData, lines: [{ ...baseLine, vatRate: '17.5' }] };

      await expect(
        buildService().runAction('company-1', 'invoice', 'save-draft', { data: dataWithBadRate }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  /**
   * B2G routing's own field-hint bridge (`applyB2gDocumentFieldHints`, documents.service.ts) — the
   * SAME `describeTypeForCompany`, given an OPTIONAL `clientId`, folds in a government client's B2G
   * rule's own `requiredDocumentFields` — e.g. Germany's Leitweg-ID (`data.buyerReference`) — even
   * for a company whose OWN country has no field overlay for it at all (here: FR, `FR_OVERLAY` above,
   * which adds "siren", never "buyerReference"). This is what closes the documented UX gap
   * `country-fields/data/de.json`'s own header names: "a seller in a country with no overlay for
   * this field... has no SCREEN control for it today".
   */
  describe('describeTypeForCompany(companyId, typeId, clientId) — the B2G document-field hint bridge', () => {
    beforeEach(() => {
      (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue('FR');
    });

    it('no clientId at all — never even asks b2g-routing, fields unchanged', async () => {
      const descriptor = await buildService().describeTypeForCompany('company-1', 'invoice');
      expect(b2gRouting.resolveClientB2gRouting).not.toHaveBeenCalled();
      expect(descriptor.fields.find((f) => f.key === 'buyerReference')).toBeUndefined();
    });

    it('a BUSINESS client (applies: false) — fields unchanged, same as no clientId', async () => {
      (b2gRouting.resolveClientB2gRouting as jest.Mock).mockResolvedValue({
        applies: false,
        missingIdentifierSchemes: [],
      });

      const descriptor = await buildService().describeTypeForCompany('company-1', 'invoice', 'client-1');
      expect(descriptor.fields.find((f) => f.key === 'buyerReference')).toBeUndefined();
    });

    it('a GOVERNMENT client whose rule requires "buyerReference" — the field is ADDED, label/required/helpText straight from the rule', async () => {
      (b2gRouting.resolveClientB2gRouting as jest.Mock).mockResolvedValue({
        applies: true,
        countryCode: 'DE',
        rule: {
          countryCode: 'DE',
          transportId: 'zre-ozgre',
          formatSyntax: 'xrechnung',
          requiredClientIdentifiers: [],
          requiredDocumentFields: [
            {
              field: 'buyerReference',
              label: 'Buyer reference (Leitweg-ID)',
              why: '§ 5 ERechV.',
              required: true,
            },
          ],
          provenanceDescription: '"§ 4/§ 5 ERechV" (checked 2026-09-01)',
        },
        missingIdentifierSchemes: [],
      });

      const descriptor = await buildService().describeTypeForCompany('company-1', 'invoice', 'client-1');
      const buyerReference = descriptor.fields.find((f) => f.key === 'buyerReference');
      expect(buyerReference).toMatchObject({
        kind: 'text',
        label: 'Buyer reference (Leitweg-ID)',
        required: true,
        helpText: '§ 5 ERechV.',
      });
      // The company's OWN overlay (FR_OVERLAY, "siren") is untouched — the two sources compose,
      // neither replaces the other.
      expect(descriptor.fields.find((f) => f.key === 'siren')).toBeDefined();
    });

    it('a field the rule requires that ALREADY exists on the descriptor is left alone — never a duplicate/throwing "add"', async () => {
      (b2gRouting.resolveClientB2gRouting as jest.Mock).mockResolvedValue({
        applies: true,
        countryCode: 'FR',
        rule: {
          countryCode: 'FR',
          transportId: 'chorus-pro',
          formatSyntax: 'facturx',
          requiredClientIdentifiers: [],
          // "notes" already exists on the trunk invoice descriptor — must not collide.
          requiredDocumentFields: [
            { field: 'notes', label: 'Notes', why: 'already exists', required: false },
          ],
          provenanceDescription: '"Code de la commande publique" (checked 2026-09-01)',
        },
        missingIdentifierSchemes: [],
      });

      const descriptor = await buildService().describeTypeForCompany('company-1', 'invoice', 'client-1');
      // FR_OVERLAY's own "modify" (required: true) still won — the B2G rule never overwrote it.
      expect(descriptor.fields.find((f) => f.key === 'notes')?.required).toBe(true);
    });
  });
});
