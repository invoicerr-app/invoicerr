/**
 * The `codeLists` section of a country file: the code tables a national format or a declaration
 * needs (an exemption code, a tax regime code, the parts of an identifier), each entry carrying the
 * condition that selects it. One pure lookup reads every list, in `lookup.ts`.
 */
import { assertValidPolicyProvenance, PolicyProvenance } from '../country-policy/schema';

export interface CodeListEntry {
  code: string;
  label: string;
  /** Input values this entry answers; absent means "any input". The first matching entry wins. */
  when?: Record<string, string[]>;
  notes?: string;
}

export interface CountryCodeList {
  id: string;
  label: string;
  entries: CodeListEntry[];
  provenance: PolicyProvenance;
}

export interface CountryCodeListsFile {
  countryCode: string;
  lists: CountryCodeList[];
}

export class InvalidCodeListsError extends Error {}

const LIST_ID_PATTERN = /^[a-z][A-Za-z0-9]*$/;

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function assertValidEntry(entry: CodeListEntry, context: string, seen: Set<string>): void {
  if (!isNonBlankString(entry?.code)) {
    throw new InvalidCodeListsError(`${context}: an entry has no "code".`);
  }
  if (seen.has(entry.code)) {
    throw new InvalidCodeListsError(`${context}: code "${entry.code}" is listed twice.`);
  }
  seen.add(entry.code);
  if (!isNonBlankString(entry.label)) {
    throw new InvalidCodeListsError(`${context}: code "${entry.code}" has no "label".`);
  }
  if (entry.when === undefined) return;
  if (typeof entry.when !== 'object' || entry.when === null || Array.isArray(entry.when)) {
    throw new InvalidCodeListsError(`${context}: code "${entry.code}" has a "when" that is not an object.`);
  }
  const conditions = Object.entries(entry.when);
  if (conditions.length === 0) {
    throw new InvalidCodeListsError(`${context}: code "${entry.code}" has an empty "when".`);
  }
  for (const [key, values] of conditions) {
    if (!Array.isArray(values) || values.length === 0 || !values.every(isNonBlankString)) {
      throw new InvalidCodeListsError(
        `${context}: code "${entry.code}" condition "${key}" must list at least one non-blank string.`,
      );
    }
  }
}

export function assertValidCodeLists(section: CountryCodeListsFile, context: string): void {
  if (!Array.isArray(section.lists) || section.lists.length === 0) {
    throw new InvalidCodeListsError(
      `${context}: "lists" must be a non-empty array; omit the section when a country needs no code table.`,
    );
  }
  const ids = new Set<string>();
  for (const list of section.lists) {
    if (!isNonBlankString(list?.id) || !LIST_ID_PATTERN.test(list.id)) {
      throw new InvalidCodeListsError(
        `${context}: a list has no valid "id" (camelCase, starting with a letter), got "${String(list?.id)}".`,
      );
    }
    if (ids.has(list.id)) {
      throw new InvalidCodeListsError(`${context}: list "${list.id}" is declared twice.`);
    }
    ids.add(list.id);
    if (!isNonBlankString(list.label)) {
      throw new InvalidCodeListsError(`${context}: list "${list.id}" has no "label".`);
    }
    if (!Array.isArray(list.entries) || list.entries.length === 0) {
      throw new InvalidCodeListsError(`${context}: list "${list.id}" declares no "entries".`);
    }
    const codes = new Set<string>();
    for (const entry of list.entries) {
      assertValidEntry(entry, `${context}: list "${list.id}"`, codes);
    }
    assertValidPolicyProvenance(list.provenance, `${context}: list "${list.id}"`, 'a code list');
  }
}
