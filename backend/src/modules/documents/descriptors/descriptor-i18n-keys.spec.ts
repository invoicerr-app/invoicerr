import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActionRegistry } from '../actions/action-registry';
import { buildActionExtensionRegistry } from '../actions/native-extensions';
import { defaultComposedCountryCatalog } from '../countries/registry';
import { NO_VAT_CATALOG_HELP_TEXT_KEY } from './company-view';
import { buildNativeDocumentTypeDescriptors } from './native-types';
import { DocumentFieldDescriptor } from './types';

// The frontend translates descriptor text by deriving these keys (frontend/src/lib/descriptor-i18n.ts)
// and falls back to the raw English text when a key is missing, so a missing key never shows up as
// a broken screen: it shows up as English in every other language. This spec is what catches it.
const EN = JSON.parse(
  readFileSync(join(__dirname, '../../../../../frontend/src/locales/en/translation.json'), 'utf-8'),
);

function englishValue(key: string): string | undefined {
  let node: unknown = EN;
  for (const segment of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

function hasKey(key: string): boolean {
  return englishValue(key) !== undefined;
}

/** Each derived key with the descriptor's own English text, which the catalog must repeat verbatim. */
type DescriptorText = [key: string, raw: string];

function fieldTexts(
  prefix: string,
  fields: DocumentFieldDescriptor[],
  parentPath: string[] = [],
): DescriptorText[] {
  return fields.flatMap((field) => {
    const path = [...parentPath, field.key];
    const base = `${prefix}.${path.join('.fields.')}`;
    return [
      [`${base}.label`, field.label] as DescriptorText,
      ...(field.helpText ? [[`${base}.helpText`, field.helpText] as DescriptorText] : []),
      ...(field.fields ? fieldTexts(prefix, field.fields, path) : []),
    ];
  });
}

function nativeDescriptorTexts(): DescriptorText[] {
  const extensions = buildActionExtensionRegistry(new ActionRegistry());
  return buildNativeDocumentTypeDescriptors().flatMap((descriptor) => {
    const root = `documents.descriptors.${descriptor.id}`;
    const allActions = [...descriptor.actions, ...extensions.listFor(descriptor.id)];
    return [
      [`${root}.label`, descriptor.label] as DescriptorText,
      ...fieldTexts(`${root}.fields`, descriptor.fields),
      ...allActions.flatMap((action) => [
        [`${root}.actions.${action.id}.label`, action.label] as DescriptorText,
        ...fieldTexts(`${root}.actions.${action.id}.params`, action.params ?? []),
      ]),
      ...(descriptor.statuses ?? []).map(
        (status) => [`${root}.statuses.${status.id}`, status.label] as DescriptorText,
      ),
    ];
  });
}

interface CountryFieldText {
  where: string;
  field: DocumentFieldDescriptor;
}

function countryOverlayFields(): CountryFieldText[] {
  const collect = (where: string, field: DocumentFieldDescriptor): CountryFieldText[] => [
    { where, field },
    ...(field.fields ?? []).flatMap((nested) => collect(`${where}.${nested.key}`, nested)),
  ];
  return defaultComposedCountryCatalog.countries().flatMap((countryCode) =>
    (defaultComposedCountryCatalog.get(countryCode)?.countryFields?.overlays ?? []).flatMap((overlay) =>
      overlay.operations.flatMap((operation) => {
        const field =
          operation.op === 'add' ? operation.field : operation.op === 'modify' ? operation.patch : null;
        if (!field) return [];
        const where = `${countryCode} ${overlay.typeId} ${operation.op} ${operation.path || '(root)'}.${field.key ?? operation.key}`;
        return collect(where, field as DocumentFieldDescriptor);
      }),
    ),
  );
}

/** A country overlay's own option labels. Each must name its English key: the frontend derives a
 *  key only for a native descriptor, and an overlay option has no type id or path of its own to
 *  derive one from, so an option without `labelKey` renders its country-file English everywhere. */
function countryOverlayOptionTexts(): Array<{ key?: string; raw: string; where: string }> {
  const collect = (
    field: DocumentFieldDescriptor,
    where: string,
  ): Array<{ key?: string; raw: string; where: string }> => [
    ...(field.options ?? []).map((option) => ({
      key: option.labelKey,
      raw: option.label,
      where: `${where} option ${option.value}`,
    })),
    ...(field.fields ?? []).flatMap((nested) => collect(nested, `${where}.${nested.key}`)),
  ];
  return defaultComposedCountryCatalog.countries().flatMap((countryCode) =>
    (defaultComposedCountryCatalog.get(countryCode)?.countryFields?.overlays ?? []).flatMap((overlay) =>
      overlay.operations.flatMap((operation) => {
        const field =
          operation.op === 'add' ? operation.field : operation.op === 'modify' ? operation.patch : null;
        if (!field) return [];
        const fieldKey = field.key ?? operation.key;
        if (!fieldKey) return [];
        const where = `${countryCode} ${overlay.typeId} ${operation.op} ${operation.path || '(root)'}.${fieldKey}`;
        return collect(field as DocumentFieldDescriptor, where);
      }),
    ),
  );
}

describe('descriptor text reaches the translation catalog', () => {
  it('every native type, field, action, param and status label and help text has an English key', () => {
    const missing = nativeDescriptorTexts()
      .map(([key]) => key)
      .filter((key) => !hasKey(key));
    expect(missing).toEqual([]);
  });

  it("the English catalog repeats the descriptor's own text, so English has one wording", () => {
    const differing = nativeDescriptorTexts()
      .filter(([key, raw]) => hasKey(key) && englishValue(key) !== raw)
      .map(([key, raw]) => `${key}: descriptor "${raw}" / catalog "${englishValue(key)}"`);
    expect(differing).toEqual([]);
  });

  it('every label and help text a country overlay adds names an existing English key', () => {
    const problems = countryOverlayFields().flatMap(({ where, field }) => [
      ...(field.label && !field.labelKey ? [`${where}: label without labelKey`] : []),
      ...(field.labelKey && !hasKey(field.labelKey) ? [`${where}: no English key ${field.labelKey}`] : []),
      ...(field.helpText && !field.helpTextKey ? [`${where}: helpText without helpTextKey`] : []),
      ...(field.helpTextKey && !hasKey(field.helpTextKey)
        ? [`${where}: no English key ${field.helpTextKey}`]
        : []),
    ]);
    expect(problems).toEqual([]);
  });

  it('every option label a country overlay adds names an English key with the same text', () => {
    const problems = countryOverlayOptionTexts().flatMap(({ key, raw, where }) => {
      if (!key) return [`${where}: option without labelKey`];
      if (!hasKey(key)) return [`${where}: no English key ${key}`];
      const value = englishValue(key);
      return value === raw ? [] : [`${where}: ${key} is "${value}", overlay says "${raw}"`];
    });
    expect(problems).toEqual([]);
  });

  it('the help text the VAT rate catalog substitutes at runtime has an English key', () => {
    expect(hasKey(NO_VAT_CATALOG_HELP_TEXT_KEY)).toBe(true);
  });
});
