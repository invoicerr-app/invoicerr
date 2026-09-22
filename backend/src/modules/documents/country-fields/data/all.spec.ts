/**
 * Used to pin an "empty, on purpose" state — see all.ts's own header for why that changed: France
 * shipped the first real field overlay (`supplyType` on `invoice.lines`, for BT-23); Germany
 * ("Peppol/Allemagne") is the SECOND, adding a document-level `buyerReference`
 * (BT-10 / Leitweg-ID) for `formats/xrechnung-provider.ts`'s own BR-DE-15. Poland is the THIRD,
 * adding a document-level `correctionReason`, conditionally required once `correctsInvoiceId`
 * (invoice.descriptor.ts's own trunk field) names the invoice being corrected — see
 * `data/pl.json`'s own header for the full "legally optional, product-required" distinction. Italy
 * and Portugal arrived with the pass that extended `lines[].supplyType` past France to all five
 * wired countries, so this file now also pins what that pass guarantees: the supply-type field is
 * BYTE-IDENTICAL in every one of them (same key, kind, label, options, optionality), because what
 * reads it branches on a Directive 2006/112/EC distinction that binds every member state the same
 * way — see each country file's own `notes` for the national text it cites. This file pins the NEW
 * state the same way the old one pinned the empty one and then the FR/DE-only one, so whoever adds
 * a SIXTH country's file has to update the one place asserting what is shipped, same discipline
 * either way.
 */
import { applyFieldOverlay } from '../apply-overlay';
import { DocumentFieldDescriptor } from '../../descriptors/types';
import { validateAgainstDescriptor } from '../../descriptors/validate';
import { FieldKindRegistry, registerCoreFieldKinds } from '../../descriptors/field-kinds';
import { ALL_COUNTRY_FIELD_OVERLAY_FILES } from './all';

const TRUNK_LINES_FIELD: DocumentFieldDescriptor = {
  key: 'lines',
  kind: 'array',
  label: 'Lines',
  fields: [{ key: 'description', kind: 'text', label: 'Designation' }],
};

const TRUNK_INVOICE_FIELDS: DocumentFieldDescriptor[] = [
  { key: 'client', kind: 'reference', label: 'Client', entity: 'client' },
  { key: 'correctsInvoiceId', kind: 'reference', label: 'Corrects invoice', entity: 'invoice' },
  TRUNK_LINES_FIELD,
];

/** The five wired countries — `lines[].supplyType` is declared by every one of them. */
const SUPPLY_TYPE_COUNTRIES = ['DE', 'FR', 'IT', 'PL', 'PT'] as const;

function supplyTypeFieldOf(countryCode: string) {
  const file = ALL_COUNTRY_FIELD_OVERLAY_FILES.find((f) => f.countryCode === countryCode)!;
  const operations = file.overlays.find((o) => o.typeId === 'invoice')!.operations;
  const applied = applyFieldOverlay([TRUNK_LINES_FIELD], operations);
  return applied.find((f) => f.key === 'lines')!.fields!.find((f) => f.key === 'supplyType');
}

describe('country-fields/data — five countries ship a real overlay', () => {
  it('ships exactly the five wired countries today', () => {
    expect(ALL_COUNTRY_FIELD_OVERLAY_FILES.map((f) => f.countryCode).sort()).toEqual([
      'DE',
      'FR',
      'IT',
      'PL',
      'PT',
    ]);
  });

  it.each(
    SUPPLY_TYPE_COUNTRIES,
  )("%s adds an OPTIONAL 'select' supplyType subfield to invoice.lines, GOODS/SERVICES only", (countryCode) => {
    const supplyType = supplyTypeFieldOf(countryCode)!;

    expect(supplyType).toBeDefined();
    expect(supplyType.kind).toBe('select');
    expect(supplyType.required).toBeFalsy();
    expect(supplyType.options?.map((o) => o.value).sort()).toEqual(['GOODS', 'SERVICES']);
    // DIGITAL is deliberately absent from every one of them: `tax/resolve-invoice-tax.ts` narrows a
    // stored value to GOODS/SERVICES, so a third option would be discarded on the way in.
    expect(supplyType.options).toHaveLength(2);
  });

  it('the supply-type field is the SAME field in all five — only the help text may name a national consequence', () => {
    // The point of the assertion: a directive-level distinction (Directive 2006/112/EC arts. 33(a)
    // and 45, see each file's own `notes`) must not silently become five slightly different controls.
    const shapes = SUPPLY_TYPE_COUNTRIES.map((countryCode) => {
      const field = supplyTypeFieldOf(countryCode)!;
      return JSON.stringify({
        key: field.key,
        kind: field.kind,
        label: field.label,
        required: field.required ?? false,
        options: field.options,
      });
    });
    expect(new Set(shapes).size).toBe(1);
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

  it("adds an OPTIONAL top-level 'text' correctionReason field to invoice, conditionally required on correctsInvoiceId (never unconditionally required)", () => {
    const pl = ALL_COUNTRY_FIELD_OVERLAY_FILES.find((f) => f.countryCode === 'PL')!;
    const operations = pl.overlays.find((o) => o.typeId === 'invoice')!.operations;

    const applied = applyFieldOverlay(TRUNK_INVOICE_FIELDS, operations);
    const correctionReason = applied.find((f) => f.key === 'correctionReason')!;

    expect(correctionReason).toBeDefined();
    expect(correctionReason.kind).toBe('text');
    // NEVER unconditionally required — an ordinary, non-correcting Polish invoice must stay unaffected.
    expect(correctionReason.required).toBeFalsy();
    expect(correctionReason.requiredIfPresent).toBe('correctsInvoiceId');
    expect(applied.find((f) => f.key === 'lines')?.fields?.some((f) => f.key === 'correctionReason')).toBe(
      false,
    );
  });

  it('Poland does not touch any other document type', () => {
    const pl = ALL_COUNTRY_FIELD_OVERLAY_FILES.find((f) => f.countryCode === 'PL')!;
    expect(pl.overlays.map((o) => o.typeId)).toEqual(['invoice']);
  });

  it('the merged field, once applied, is genuinely conditional end to end — validateAgainstDescriptor (the real gate) only refuses a missing correctionReason once correctsInvoiceId is set', () => {
    const pl = ALL_COUNTRY_FIELD_OVERLAY_FILES.find((f) => f.countryCode === 'PL')!;
    const operations = pl.overlays.find((o) => o.typeId === 'invoice')!.operations;
    const applied = applyFieldOverlay(TRUNK_INVOICE_FIELDS, operations);
    const registry = new FieldKindRegistry();
    registerCoreFieldKinds(registry);

    // An ORDINARY invoice (no correctsInvoiceId at all): no error for the missing reason.
    const ordinaryErrors = validateAgainstDescriptor(applied, { client: 'client-1', lines: [] }, registry);
    expect(ordinaryErrors.some((e) => e.key === 'correctionReason')).toBe(false);

    // A CORRECTING invoice with no reason: refused, by name.
    const correctingErrors = validateAgainstDescriptor(
      applied,
      { client: 'client-1', correctsInvoiceId: 'invoice-1', lines: [] },
      registry,
    );
    expect(correctingErrors.some((e) => e.key === 'correctionReason')).toBe(true);

    // A CORRECTING invoice WITH a reason: passes.
    const filledErrors = validateAgainstDescriptor(
      applied,
      {
        client: 'client-1',
        correctsInvoiceId: 'invoice-1',
        correctionReason: 'Erreur de quantité',
        lines: [],
      },
      registry,
    );
    expect(filledErrors.some((e) => e.key === 'correctionReason')).toBe(false);
  });
});

// Drop-in invariant (readdir-discovery conversion, 2026-09-13) — proves all.ts's own
// `discoverCountryCodes()` really does pick up every `<cc>.json` sitting in this directory, the same
// guarantee `b2g-routing/data/all.spec.ts` and `reporting/data/all.spec.ts` already pin for their own
// loaders: this test re-reads the directory with the IDENTICAL pattern, independently of all.ts's own
// implementation, so a regression that silently drops a file from discovery (a typo'd pattern, a
// change that stops sorting, anything) goes red here — the whole point of "adding a country = dropping
// a file, no code change" is only true if this holds.
describe('country-fields/data — every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_COUNTRY_FIELD_OVERLAY_FILES covers exactly the country files present in this directory, no more, no fewer', () => {
    const { readdirSync } = require('node:fs');
    const onDisk = readdirSync(__dirname)
      .filter((name: string) => /^[a-z]{2}\.json$/.test(name))
      .map((name: string) => name.replace(/\.json$/, '').toUpperCase())
      .sort();
    const loaded = ALL_COUNTRY_FIELD_OVERLAY_FILES.map((f) => f.countryCode).sort();
    expect(loaded).toEqual(onDisk);
  });
});
