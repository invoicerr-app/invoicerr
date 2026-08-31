/**
 * Used to pin an "empty, on purpose" state — see all.ts's own header for why that changed: France
 * now ships its first real field overlay (`supplyType` on `invoice.lines`, for BT-23). This file
 * pins the NEW state the same way the old one pinned the empty one, so whoever adds a SECOND
 * country's file has to update the one place asserting what is shipped, same discipline either way.
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

describe('country-fields/data — France ships its first real overlay', () => {
  it('ships exactly France today', () => {
    expect(ALL_COUNTRY_FIELD_OVERLAY_FILES.map((f) => f.countryCode)).toEqual(['FR']);
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

  it('does not touch any other document type', () => {
    const fr = ALL_COUNTRY_FIELD_OVERLAY_FILES.find((f) => f.countryCode === 'FR')!;
    expect(fr.overlays.map((o) => o.typeId)).toEqual(['invoice']);
  });
});
