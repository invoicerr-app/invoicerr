/**
 * The pure half of the vendor export reader: detect which tool produced a file from
 * its header row. No Prisma, no Nest, no file I/O: the browser parses the bytes, this module only
 * translates.
 *
 * A file whose headers do not match any profile is not an error here (`detectVendorExport` returns
 * undefined) because both import dialogs fall back to their generic template import.
 */
import { VENDOR_EXPORT_PROFILES } from './vendor-export-profiles';
import { VendorExportKind, VendorExportProfile } from './vendor-export.types';

/**
 * Drops a balanced `(...)` segment, keeping unbalanced text as it was. Done with `indexOf` rather
 * than `/\([^)]*\)/g`: on a header whose first run of many `(` never closes, that regex rescans the
 * rest of the string at every position, which is quadratic in the length of a user-provided file.
 */
function stripParentheticals(value: string): string {
  let result = '';
  let rest = value;
  for (;;) {
    const open = rest.indexOf('(');
    if (open === -1) return result + rest;
    const close = rest.indexOf(')', open + 1);
    if (close === -1) return result + rest;
    result += `${rest.slice(0, open)} `;
    rest = rest.slice(close + 1);
  }
}

/** Accent-, case- and punctuation-insensitive header key. `N° de facture` -> `n de facture`. */
export function normalizeHeader(value: string): string {
  return stripParentheticals(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** First profile whose signature is fully present in `headers`, in declaration order. */
export function detectVendorExport(
  kind: VendorExportKind,
  headers: string[],
  profiles: readonly VendorExportProfile[] = VENDOR_EXPORT_PROFILES,
): VendorExportProfile | undefined {
  const present = new Set(headers.map(normalizeHeader).filter(Boolean));
  return profiles.find(
    (profile) =>
      profile.kind === kind &&
      profile.signature.every((group) => group.some((alias) => present.has(normalizeHeader(alias)))),
  );
}
