/**
 * Used to pin an "empty, on purpose" state — see all.ts's own header for why that changed: France
 * shipped the first real field overlay (`supplyType` on `invoice.lines`, for BT-23); Germany
 * (root TODO item 26, "Peppol/Allemagne") is the SECOND, adding a document-level `buyerReference`
 * (BT-10 / Leitweg-ID) for `formats/xrechnung-provider.ts`'s own BR-DE-15. This file pins the NEW
 * state the same way the old one pinned the empty one and then the FR-only one, so whoever adds a
 * THIRD country's file has to update the one place asserting what is shipped, same discipline either
 * way.
 */
import { applyFieldOverlay } from '../apply-overlay';
import { DocumentFieldDescriptor } from '../../descriptors/types';
import { ALL_COUNTRY_FIELD_OVERLAY_FILES } from './all';

const TRUNK_LINES_FIELD: DocumentFieldDescriptor = {
  key: 'lines',
  kind: 'array',
  label: 'Lines',
  fields: [{ key: 'description', kind: 'text', label: 'Designation' }],
};

const TRUNK_INVOICE_FIELDS: DocumentFieldDescriptor[] = [
  { key: 'client', kind: 'reference', label: 'Client', entity: 'client' },
  TRUNK_LINES_FIELD,
];

describe('country-fields/data — France and Germany each ship a real overlay', () => {
  it('ships exactly France and Germany today', () => {
    expect(ALL_COUNTRY_FIELD_OVERLAY_FILES.map((f) => f.countryCode).sort()).toEqual(['DE', 'FR']);
  });

  it("adds an OPTIONAL 'select' supplyType subfield to invoice.lines, GOODS/SERVICES only", () => {
    const fr = ALL_COUNTRY_FIELD_OVERLAY_FILES.find((f) => f.countryCode === 'FR')!;
    const operations = fr.overlays.find((o) => o.typeId === 'invoice')!.operations;

    const applied = applyFieldOverlay([TRUNK_LINES_FIELD], operations);
    const linesField = applied.find((f) => f.key === 'lines')!;
    const supplyType = linesField.fields!.find((f) => f.key === 'supplyType')!;

    expect(supplyType.kind).toBe('select');
    expect(supplyType.required).toBeFalsy();
    expect(supplyType.options?.map((o) => o.value).sort()).toEqual(['GOODS', 'SERVICES']);
  });

  it('France does not touch any other document type', () => {
    const fr = ALL_COUNTRY_FIELD_OVERLAY_FILES.find((f) => f.countryCode === 'FR')!;
    expect(fr.overlays.map((o) => o.typeId)).toEqual(['invoice']);
  });

  it("adds an OPTIONAL top-level 'text' buyerReference field to invoice (BT-10 / Leitweg-ID)", () => {
    const de = ALL_COUNTRY_FIELD_OVERLAY_FILES.find((f) => f.countryCode === 'DE')!;
    const operations = de.overlays.find((o) => o.typeId === 'invoice')!.operations;

    const applied = applyFieldOverlay(TRUNK_INVOICE_FIELDS, operations);
    const buyerReference = applied.find((f) => f.key === 'buyerReference')!;

    expect(buyerReference).toBeDefined();
    expect(buyerReference.kind).toBe('text');
    expect(buyerReference.required).toBeFalsy();
    // Document-level — added at the TOP LEVEL (`lines` untouched), unlike France's own line subfield.
    expect(applied.find((f) => f.key === 'lines')?.fields?.some((f) => f.key === 'buyerReference')).toBe(
      false,
    );
  });

  it('Germany does not touch any other document type', () => {
    const de = ALL_COUNTRY_FIELD_OVERLAY_FILES.find((f) => f.countryCode === 'DE')!;
    expect(de.overlays.map((o) => o.typeId)).toEqual(['invoice']);
  });
});
