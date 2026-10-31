import { decimalsFor } from '@/utils/financial';

import { defaultComposedCountryCatalog } from '../countries/registry';
import { defaultCountryIdentifierRequirementsCatalog } from '../country-identifiers/registry';
import { RenderLanguage } from '../rendering/language/supported-languages';
import {
  CompanyLawField,
  CompanyLawFieldKind,
  CompanyLawMention,
  CompanyLawPlaceholder,
  CountryCompanyLawFile,
  parseTemplate,
  templatePlaceholders,
} from './schema';

export interface CompanyLawMoney {
  amount: string;
  currency: string;
}

export type CompanyLawValue = string | CompanyLawMoney;

/** What a company stores in `Company.companyLaw`. */
export interface CompanyLawDetails {
  legalForm?: string | null;
  values?: Record<string, CompanyLawValue>;
}

export type CompanyLawLinePart = { text: string } | { missing: string };

export interface CompanyLawLine {
  parts: CompanyLawLinePart[];
}

export interface MissingCompanyLawField {
  /** A field key, `legalForm`, or the identifier scheme a template quotes. */
  key: string;
  label: string;
}

export interface CompanyLawMentions {
  /** Every line the document prints, a required one with a gap included, in declaration order. */
  lines: CompanyLawLine[];
  missing: MissingCompanyLawField[];
}

export interface CompanyLawMentionsInput {
  countryCode: string | null | undefined;
  documentTypeId: string;
  language: RenderLanguage;
  details: unknown;
  identifiers: readonly { scheme: string; value: string }[];
}

export class CompanyLawCatalog {
  private readonly files: Map<string, CountryCompanyLawFile>;

  constructor(files: CountryCompanyLawFile[] = filesFromComposedCatalog()) {
    this.files = new Map(files.map((file) => [file.countryCode.toUpperCase(), file]));
  }

  fileFor(countryCode: string | null | undefined): CountryCompanyLawFile | undefined {
    return this.files.get((countryCode ?? '').trim().toUpperCase());
  }
}

function filesFromComposedCatalog(): CountryCompanyLawFile[] {
  return defaultComposedCountryCatalog
    .countries()
    .map((countryCode) => defaultComposedCountryCatalog.get(countryCode)?.companyLaw)
    .filter((file): file is CountryCompanyLawFile => !!file);
}

export const defaultCompanyLawCatalog = new CompanyLawCatalog();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isMoney = (value: unknown): value is CompanyLawMoney =>
  isRecord(value) && typeof value.amount === 'string' && typeof value.currency === 'string';

/** Reads the stored JSON leniently: an entry of the wrong shape is ignored, never trusted. */
export function readCompanyLawDetails(stored: unknown): CompanyLawDetails {
  if (!isRecord(stored)) return {};
  const values: Record<string, CompanyLawValue> = {};
  if (isRecord(stored.values)) {
    for (const [key, value] of Object.entries(stored.values)) {
      if (typeof value === 'string' || isMoney(value)) values[key] = value;
    }
  }
  return { legalForm: typeof stored.legalForm === 'string' ? stored.legalForm : null, values };
}

function formatMoney(money: CompanyLawMoney): string | undefined {
  const amount = Number(money.amount);
  const currency = money.currency.trim().toUpperCase();
  if (!money.amount.trim() || Number.isNaN(amount) || !currency) return undefined;
  return `${amount.toFixed(decimalsFor(currency))} ${currency}`;
}

function fieldValue(
  field: CompanyLawField | undefined,
  value: CompanyLawValue | undefined,
): string | undefined {
  if (!field || value === undefined) return undefined;
  if (field.kind === 'money') return isMoney(value) ? formatMoney(value) : undefined;
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

interface Resolution {
  value?: string;
  missing: MissingCompanyLawField;
}

function resolver(file: CountryCompanyLawFile, input: CompanyLawMentionsInput, details: CompanyLawDetails) {
  const form = file.legalForms.find((candidate) => candidate.code === details.legalForm);
  const identifierLabels = new Map(
    defaultCountryIdentifierRequirementsCatalog
      .schemesFor(file.countryCode)
      .map((scheme) => [scheme.scheme, scheme.label]),
  );
  return (placeholder: CompanyLawPlaceholder): Resolution => {
    if (placeholder.kind === 'legalForm') {
      return { value: form?.designation, missing: { key: 'legalForm', label: file.legalFormLabel } };
    }
    if (placeholder.kind === 'identifier') {
      const value = input.identifiers.find((identifier) => identifier.scheme === placeholder.scheme)?.value;
      return {
        value: value?.trim() || undefined,
        missing: {
          key: placeholder.scheme,
          label: identifierLabels.get(placeholder.scheme) ?? placeholder.scheme,
        },
      };
    }
    const field = file.fields.find((candidate) => candidate.key === placeholder.key);
    return {
      value: fieldValue(field, details.values?.[placeholder.key]),
      missing: { key: placeholder.key, label: field?.label ?? placeholder.key },
    };
  };
}

function mentionsFor(file: CountryCompanyLawFile, documentTypeId: string): CompanyLawMention[] {
  return file.mentions.filter((mention) => mention.documentTypes.includes(documentTypeId));
}

/**
 * The company-law mentions the seller's country requires on this document type, in the document's
 * language, and every value still missing from a required one.
 */
export function companyLawMentions(
  input: CompanyLawMentionsInput,
  catalog: CompanyLawCatalog = defaultCompanyLawCatalog,
): CompanyLawMentions {
  const file = catalog.fileFor(input.countryCode);
  if (!file) return { lines: [], missing: [] };
  const declared = mentionsFor(file, input.documentTypeId);
  const details = readCompanyLawDetails(input.details);
  const form = file.legalForms.find((candidate) => candidate.code === details.legalForm);

  if (!form) {
    if (!declared.some((mention) => mention.required)) return { lines: [], missing: [] };
    const missing = { key: 'legalForm', label: file.legalFormLabel };
    return { lines: [{ parts: [{ missing: missing.label }] }], missing: [missing] };
  }

  const resolve = resolver(file, input, details);
  const lines: CompanyLawLine[] = [];
  const missing = new Map<string, MissingCompanyLawField>();
  for (const mention of declared.filter((candidate) => candidate.legalForms.includes(form.code))) {
    const parts: CompanyLawLinePart[] = parseTemplate(mention.template[input.language]).map((part) => {
      if ('text' in part) return part;
      const resolution = resolve(part.placeholder);
      return resolution.value === undefined
        ? { missing: resolution.missing.label }
        : { text: resolution.value };
    });
    const gaps = parts.filter((part) => 'missing' in part);
    if (gaps.length > 0 && !mention.required) continue;
    for (const placeholder of templatePlaceholders(mention.template[input.language])) {
      const resolution = resolve(placeholder);
      if (resolution.value === undefined) missing.set(resolution.missing.key, resolution.missing);
    }
    lines.push({ parts });
  }
  return { lines, missing: [...missing.values()] };
}

export interface CompanyLawFormField {
  key: string;
  kind: CompanyLawFieldKind;
  label: string;
  required: boolean;
}

export interface CompanyLawSettings {
  legalFormLabel?: string;
  legalForms: { code: string; name: string; fields: CompanyLawFormField[] }[];
}

function quotesField(mention: CompanyLawMention, key: string): boolean {
  return templatePlaceholders(mention.template.en).some(
    (placeholder) => placeholder.kind === 'field' && placeholder.key === key,
  );
}

function fieldsFor(file: CountryCompanyLawFile, formCode: string): CompanyLawFormField[] {
  const mentions = file.mentions.filter((mention) => mention.legalForms.includes(formCode));
  return file.fields.flatMap((field) => {
    const quoting = mentions.filter((mention) => quotesField(mention, field.key));
    if (quoting.length === 0 && !field.asked) return [];
    return [
      { key: field.key, kind: field.kind, label: field.label, required: quoting.some((m) => m.required) },
    ];
  });
}

/** What the company settings screen asks for: each legal form and the fields its mentions quote. */
export function companyLawSettings(
  countryCode: string | null | undefined,
  catalog: CompanyLawCatalog = defaultCompanyLawCatalog,
): CompanyLawSettings {
  const file = catalog.fileFor(countryCode);
  if (!file) return { legalForms: [] };
  return {
    legalFormLabel: file.legalFormLabel,
    legalForms: file.legalForms.map((form) => ({
      code: form.code,
      name: form.name,
      fields: fieldsFor(file, form.code),
    })),
  };
}

/** The legal form and values a demo company of this country is seeded with, read from its section. */
export function demoCompanyLaw(
  countryCode: string,
  companyName: string,
  city: string,
  catalog: CompanyLawCatalog = defaultCompanyLawCatalog,
): CompanyLawDetails | undefined {
  const demo = catalog.fileFor(countryCode)?.demo;
  if (!demo) return undefined;
  const suffix = Object.keys(demo.legalFormByNameSuffix)
    .toSorted((a, b) => b.length - a.length)
    .find((candidate) => companyName.endsWith(` ${candidate}`));
  if (!suffix) return undefined;
  const values: Record<string, CompanyLawValue> = {};
  for (const [key, value] of Object.entries(demo.values)) {
    values[key] = typeof value === 'string' ? value.replaceAll('{city}', city) : value;
  }
  return { legalForm: demo.legalFormByNameSuffix[suffix], values };
}

export class InvalidCompanyLawDetailsError extends Error {}

const AMOUNT = /^\d{1,15}(\.\d{1,4})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_TEXT_LENGTH = 500;

function normalizeValue(key: string, value: unknown): CompanyLawValue | undefined {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.length > MAX_TEXT_LENGTH)
      throw new InvalidCompanyLawDetailsError(
        `companyLaw.values.${key} is longer than ${MAX_TEXT_LENGTH} characters.`,
      );
    return text || undefined;
  }
  if (isRecord(value)) {
    const amount = typeof value.amount === 'string' ? value.amount.trim() : '';
    const currency = typeof value.currency === 'string' ? value.currency.trim().toUpperCase() : '';
    if (!amount) return undefined;
    if (!AMOUNT.test(amount) || !CURRENCY.test(currency))
      throw new InvalidCompanyLawDetailsError(
        `companyLaw.values.${key} must be an amount such as "1000.00" with a three-letter currency code.`,
      );
    return { amount, currency };
  }
  if (value === null || value === undefined) return undefined;
  throw new InvalidCompanyLawDetailsError(
    `companyLaw.values.${key} must be text or an amount with a currency.`,
  );
}

function normalizeValues(input: unknown): Record<string, CompanyLawValue> {
  const values: Record<string, CompanyLawValue> = {};
  if (input === undefined || input === null) return values;
  if (!isRecord(input)) throw new InvalidCompanyLawDetailsError('companyLaw.values must be an object.');
  for (const [key, value] of Object.entries(input)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(key))
      throw new InvalidCompanyLawDetailsError(`companyLaw.values has an invalid key "${key}".`);
    const normalized = normalizeValue(key, value);
    if (normalized !== undefined) values[key] = normalized;
  }
  return values;
}

/**
 * Checks what a company submits before it is stored. Values are kept whatever the country, so
 * switching country and back loses nothing; `null` clears everything.
 */
export function normalizeCompanyLawDetails(input: unknown): CompanyLawDetails | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (!isRecord(input)) throw new InvalidCompanyLawDetailsError('companyLaw must be an object.');
  const legalForm = typeof input.legalForm === 'string' ? input.legalForm.trim() || null : null;
  return { legalForm, values: normalizeValues(input.values) };
}
