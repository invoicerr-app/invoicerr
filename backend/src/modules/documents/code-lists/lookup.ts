/**
 * The one lookup every country code table goes through. It answers the first entry whose conditions
 * all hold, in the order the country file declares them, and throws when nothing matches: a code
 * table is read to produce a legally required code, so a silent default would invent one.
 */
import { CodeListEntry, CountryCodeList, CountryCodeListsFile } from './schema';

export class UnmappedCodeError extends Error {}

/** The facts a lookup is made against, by condition key. */
export type CodeListInput = Record<string, string | undefined>;

/** An entry with no condition answers any input; otherwise every condition key must hold. */
function matches(entry: CodeListEntry, input: CodeListInput): boolean {
  if (!entry.when) return true;
  return Object.entries(entry.when).every(([key, allowed]) => {
    const value = input[key];
    return value !== undefined && allowed.includes(value);
  });
}

export function firstMatchingEntry(list: CountryCodeList, input: CodeListInput): CodeListEntry | undefined {
  return list.entries.find((entry) => matches(entry, input));
}

export function lookupCodeList(list: CountryCodeList, input: CodeListInput): CodeListEntry {
  const entry = firstMatchingEntry(list, input);
  if (entry) return entry;
  const described = Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
  throw new UnmappedCodeError(
    `No code in list "${list.id}" matches ${described || 'an empty input'}; ` +
      `the list holds ${list.entries.map((candidate) => candidate.code).join(', ')}.`,
  );
}

export function lookupIn(file: CountryCodeListsFile, listId: string, input: CodeListInput): CodeListEntry {
  const list = file.lists.find((candidate) => candidate.id === listId);
  if (!list) {
    throw new UnmappedCodeError(`No code list "${listId}" is declared for ${file.countryCode}.`);
  }
  return lookupCodeList(list, input);
}
