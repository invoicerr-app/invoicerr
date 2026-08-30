import { CountryFieldOverlayCatalog } from '../country-fields/registry';
import { CountryFieldOverlayFile } from '../country-fields/schema';
import { VatRateCatalog } from '../vat-rates/registry';
import { CountryVatRatesFile } from '../vat-rates/schema';
import { applyCompanyFieldView } from './company-view';
import { DocumentFieldDescriptor } from './types';

const FIELDS: DocumentFieldDescriptor[] = [
  { key: 'client', kind: 'reference', label: 'Client', required: true, entity: 'client' },
  {
    key: 'lines',
    kind: 'array',
    label: 'Lines',
    required: true,
    fields: [
      { key: 'description', kind: 'text', label: 'Designation', required: true },
      {
        key: 'vatRate',
        kind: 'select',
        label: 'VAT rate',
        required: true,
        options: [],
        allowCustomValue: true,
        usesVatRateCatalog: true,
        helpText: 'The VAT rate that applies to this line.',
      },
    ],
  },
];

const FR_VAT: CountryVatRatesFile = {
  countryCode: 'FR',
  rates: [
    {
      id: 'fr-standard',
      rate: 20,
      label: 'Taux normal',
      category: 'STANDARD',
      provenance: { kind: 'unverified', resolutionNote: 'n' },
    },
  ],
};

const FR_OVERLAY: CountryFieldOverlayFile = {
  countryCode: 'FR',
  overlays: [{ typeId: 'invoice', operations: [{ op: 'remove', path: '', key: 'client' }] }],
};

function build(overlayFiles: CountryFieldOverlayFile[] = [], vatFiles: CountryVatRatesFile[] = []) {
  return {
    fieldOverlayCatalog: new CountryFieldOverlayCatalog(overlayFiles),
    vatRateCatalog: new VatRateCatalog(vatFiles),
  };
}

describe('applyCompanyFieldView', () => {
  it('a country with no overlay and no known VAT catalog: the trunk shape is intact, and the VAT field gets an honest "no known list" notice', () => {
    const { fieldOverlayCatalog, vatRateCatalog } = build();

    const result = applyCompanyFieldView({
      typeId: 'invoice',
      fields: FIELDS,
      countryCode: 'DE',
      fieldOverlayCatalog,
      vatRateCatalog,
    });

    expect(result.map((f) => f.key)).toEqual(['client', 'lines']);
    const vatField = result.find((f) => f.key === 'lines')?.fields?.find((f) => f.key === 'vatRate');
    expect(vatField?.options).toEqual([]);
    expect(vatField?.helpText).toMatch(/No known VAT rate list/);
  });

  it('an UNRESOLVED country (undefined) behaves exactly like an unknown one — never throws', () => {
    const { fieldOverlayCatalog, vatRateCatalog } = build();

    const result = applyCompanyFieldView({
      typeId: 'invoice',
      fields: FIELDS,
      countryCode: undefined,
      fieldOverlayCatalog,
      vatRateCatalog,
    });

    const vatField = result.find((f) => f.key === 'lines')?.fields?.find((f) => f.key === 'vatRate');
    expect(vatField?.options).toEqual([]);
    expect(vatField?.helpText).toMatch(/No known VAT rate list/);
  });

  it('a country WITH a known VAT catalog: options are filled, and the original helpText is left alone', () => {
    const { fieldOverlayCatalog, vatRateCatalog } = build([], [FR_VAT]);

    const result = applyCompanyFieldView({
      typeId: 'invoice',
      fields: FIELDS,
      countryCode: 'FR',
      fieldOverlayCatalog,
      vatRateCatalog,
    });

    const vatField = result.find((f) => f.key === 'lines')?.fields?.find((f) => f.key === 'vatRate');
    expect(vatField?.options).toEqual([{ value: '20', label: '20% — Taux normal' }]);
    expect(vatField?.helpText).toBe('The VAT rate that applies to this line.');
  });

  it('applies a country field overlay AND the VAT catalog pass together', () => {
    const { fieldOverlayCatalog, vatRateCatalog } = build([FR_OVERLAY], [FR_VAT]);

    const result = applyCompanyFieldView({
      typeId: 'invoice',
      fields: FIELDS,
      countryCode: 'FR',
      fieldOverlayCatalog,
      vatRateCatalog,
    });

    expect(result.map((f) => f.key)).toEqual(['lines']); // 'client' removed by the overlay
    const vatField = result[0].fields?.find((f) => f.key === 'vatRate');
    expect(vatField?.options).toEqual([{ value: '20', label: '20% — Taux normal' }]);
  });

  it('never mutates the fields it was given', () => {
    const { fieldOverlayCatalog, vatRateCatalog } = build([], [FR_VAT]);
    const before = JSON.parse(JSON.stringify(FIELDS));

    applyCompanyFieldView({
      typeId: 'invoice',
      fields: FIELDS,
      countryCode: 'FR',
      fieldOverlayCatalog,
      vatRateCatalog,
    });

    expect(FIELDS).toEqual(before);
  });

  it('a field an overlay just ADDS is itself eligible for the VAT-catalog pass', () => {
    const overlay: CountryFieldOverlayFile = {
      countryCode: 'FR',
      overlays: [
        {
          typeId: 'invoice',
          operations: [
            {
              op: 'add',
              path: 'lines',
              field: {
                key: 'secondVatRate',
                kind: 'select',
                label: 'Second VAT rate',
                options: [],
                allowCustomValue: true,
                usesVatRateCatalog: true,
              },
            },
          ],
        },
      ],
    };
    const { fieldOverlayCatalog, vatRateCatalog } = build([overlay], [FR_VAT]);

    const result = applyCompanyFieldView({
      typeId: 'invoice',
      fields: FIELDS,
      countryCode: 'FR',
      fieldOverlayCatalog,
      vatRateCatalog,
    });

    const added = result.find((f) => f.key === 'lines')?.fields?.find((f) => f.key === 'secondVatRate');
    expect(added?.options).toEqual([{ value: '20', label: '20% — Taux normal' }]);
  });
});
