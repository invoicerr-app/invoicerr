import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActionRegistry } from '../actions/action-registry';
import { buildActionExtensionRegistry } from '../actions/native-extensions';
import { ALL_B2G_ROUTING_FILES } from '../b2g-routing/data/all';
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

  // Issue #706: a B2G rule synthesises a field on the invoice form. Its label and help text must be
  // translatable, and the long `why` stays provenance rather than becoming the popover text.
  it('every field a B2G routing rule adds names existing English label and help text keys', () => {
    const problems = ALL_B2G_ROUTING_FILES.flatMap((rule) =>
      (rule.requiredDocumentFields ?? []).flatMap((field) => [
        ...(field.labelKey ? [] : [`${rule.countryCode} ${field.field}: label without labelKey`]),
        ...(field.labelKey && !hasKey(field.labelKey)
          ? [`${rule.countryCode} ${field.field}: no English key ${field.labelKey}`]
          : []),
        ...(field.helpTextKey ? [] : [`${rule.countryCode} ${field.field}: helpText without helpTextKey`]),
        ...(field.helpTextKey && !hasKey(field.helpTextKey)
          ? [`${rule.countryCode} ${field.field}: no English key ${field.helpTextKey}`]
          : []),
      ]),
    );
    expect(problems).toEqual([]);
  });

  it('the help text the VAT rate catalog substitutes at runtime has an English key', () => {
    expect(hasKey(NO_VAT_CATALOG_HELP_TEXT_KEY)).toBe(true);
  });
});
