import { assertValidCountryFields, CountryFieldOverlayFile, InvalidCountryFieldOverlayError } from './schema';

function fileWith(overlays: CountryFieldOverlayFile['overlays']): CountryFieldOverlayFile {
  return { countryCode: 'ZZ', overlays };
}

describe('assertValidCountryFields', () => {
  it('accepts a well-formed file with add/modify/remove operations', () => {
    expect(() =>
      assertValidCountryFields(
        fileWith([
          {
            typeId: 'invoice',
            operations: [
              { op: 'add', path: '', field: { key: 'buyerReference', kind: 'text', label: 'Ref' } },
              { op: 'modify', path: '', key: 'buyerReference', patch: { required: true } },
              { op: 'remove', path: '', key: 'buyerReference' },
            ],
          },
        ]),
        'test',
      ),
    ).not.toThrow();
  });

  it('accepts an empty overlays array — a country with no overlay is the ordinary case', () => {
    expect(() => assertValidCountryFields(fileWith([]), 'test')).not.toThrow();
  });

  it('rejects a non-array "overlays"', () => {
    const broken = { countryCode: 'ZZ', overlays: 'not-an-array' } as unknown as CountryFieldOverlayFile;
    expect(() => assertValidCountryFields(broken, 'test')).toThrow(InvalidCountryFieldOverlayError);
  });

  it('rejects an overlay block missing "typeId"', () => {
    const broken = fileWith([{ operations: [] } as never]);
    expect(() => assertValidCountryFields(broken, 'test')).toThrow(/missing its "typeId"/);
  });

  // THE MUTATION TARGET (bug #3 — "a second block for the same type is silently ignored"):
  // registry.ts#operationsFor resolves ONE block per typeId with a bare `.find()`.
  it('rejects a SECOND overlay block for the same typeId — registry.ts would silently drop it', () => {
    const broken = fileWith([
      { typeId: 'invoice', operations: [] },
      { typeId: 'invoice', operations: [] },
    ]);
    expect(() => assertValidCountryFields(broken, 'test')).toThrow(/declared in more than one overlay block/);
  });

  it('rejects an overlay block whose "operations" is not an array', () => {
    const broken = fileWith([{ typeId: 'invoice', operations: 'nope' } as never]);
    expect(() => assertValidCountryFields(broken, 'test')).toThrow(/missing "operations"/);
  });

  it('rejects an operation with a non-string "path"', () => {
    const broken = fileWith([
      { typeId: 'invoice', operations: [{ op: 'remove', path: 42, key: 'x' } as never] },
    ]);
    expect(() => assertValidCountryFields(broken, 'test')).toThrow(/"path" must be a string/);
  });

  it('rejects "add" with no field / no field.key', () => {
    const noField = fileWith([{ typeId: 'invoice', operations: [{ op: 'add', path: '' } as never] }]);
    expect(() => assertValidCountryFields(noField, 'test')).toThrow(/missing a field with a "key"/);

    const noKey = fileWith([
      { typeId: 'invoice', operations: [{ op: 'add', path: '', field: { kind: 'text' } } as never] },
    ]);
    expect(() => assertValidCountryFields(noKey, 'test')).toThrow(/missing a field with a "key"/);
  });

  it('rejects "add" whose field has no "kind"', () => {
    const broken = fileWith([
      { typeId: 'invoice', operations: [{ op: 'add', path: '', field: { key: 'x' } } as never] },
    ]);
    expect(() => assertValidCountryFields(broken, 'test')).toThrow(/missing a "kind"/);
  });

  it('rejects "modify"/"remove" with no "key"', () => {
    const modify = fileWith([
      { typeId: 'invoice', operations: [{ op: 'modify', path: '', patch: {} } as never] },
    ]);
    expect(() => assertValidCountryFields(modify, 'test')).toThrow(
      /missing the "key" of the field to modify/,
    );

    const remove = fileWith([{ typeId: 'invoice', operations: [{ op: 'remove', path: '' } as never] }]);
    expect(() => assertValidCountryFields(remove, 'test')).toThrow(
      /missing the "key" of the field to remove/,
    );
  });

  // THE MUTATION TARGET (bug #2 — "an unknown op is a silent no-op"): a typo'd `op` (e.g. "delete" for
  // "remove") must be a loud, named failure at LOAD time, never reach apply-overlay.ts's own switch.
  it('rejects an unknown "op" value — the exact typo (e.g. "delete" for "remove") that used to vanish silently', () => {
    const broken = fileWith([
      { typeId: 'invoice', operations: [{ op: 'delete', path: '', key: 'x' } as never] },
    ]);
    expect(() => assertValidCountryFields(broken, 'test')).toThrow(/unknown "op" "delete"/);
  });
});
