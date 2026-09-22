/**
 * The CLOSED font set document branding may choose from (chantier B,
 * 2026-09-15 product decision: a preset picks a font from a fixed, embedded catalog — never an
 * arbitrary webfont a company could point at, exactly the same "a country is data" discipline this
 * codebase already holds for its compliance catalogs, applied here to typography instead). Five
 * OFL-1.1 licensed families, `.woff2`, weights 400/700 only — see the sibling `fonts/LICENSES.md`
 * for the exact copyright line and upstream URL of each. Every `key` here doubles as
 * `Company.brandingFont`'s only valid values (`isBrandingFontKey` is the one place that enforces
 * that) and as the id the frontend's font picker renders.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { logger } from '@/logger/logger.service';

export type BrandingFontKey = 'inter' | 'sourceSerif4' | 'ibmPlexSans' | 'dmSans' | 'lora';

interface FontWeightFile {
  weight: 400 | 700;
  /** File name under this entry's own `dir`, i.e. `rendering/fonts/<dir>/<fileName>`. */
  fileName: string;
}

export interface BrandingFontCatalogEntry {
  key: BrandingFontKey;
  /** Human-facing name — the font picker's own label. */
  label: string;
  /** The directory under `rendering/fonts/` this family's `.woff2` files live in. */
  dir: string;
  /** The CSS `font-family` NAME the embedded `@font-face` rules declare — deliberately prefixed
   *  rather than the family's plain name (e.g. `"InvoicerrBrandInter"`, never bare `"Inter"`): a
   *  viewer's OS may happen to have its own "Inter" already installed, in a different version or
   *  subset than the exact file this catalog embeds, and CSS has no way to say "only the one I just
   *  supplied" for a bare family name — a private, collision-proof name makes the embedded
   *  `@font-face` the only possible match. */
  cssFamily: string;
  /** Ordinary system-font fallbacks, appended after `cssFamily` — so a render where the embedded
   *  `@font-face` failed to load (a corrupted file, see `fontFaceCssFor`) still shows readable text
   *  in a similar register (serif stays serif, sans stays sans) rather than falling through to
   *  whatever the browser's bare default happens to be. */
  fallbackStack: string;
  weights: FontWeightFile[];
}

export const FONT_CATALOG: readonly BrandingFontCatalogEntry[] = [
  {
    key: 'inter',
    label: 'Inter',
    dir: 'inter',
    cssFamily: 'InvoicerrBrandInter',
    fallbackStack:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    weights: [
      { weight: 400, fileName: 'inter-400.woff2' },
      { weight: 700, fileName: 'inter-700.woff2' },
    ],
  },
  {
    key: 'sourceSerif4',
    label: 'Source Serif 4',
    dir: 'source-serif-4',
    cssFamily: 'InvoicerrBrandSourceSerif4',
    fallbackStack: 'Georgia, "Times New Roman", Times, serif',
    weights: [
      { weight: 400, fileName: 'source-serif-4-400.woff2' },
      { weight: 700, fileName: 'source-serif-4-700.woff2' },
    ],
  },
  {
    key: 'ibmPlexSans',
    label: 'IBM Plex Sans',
    dir: 'ibm-plex-sans',
    cssFamily: 'InvoicerrBrandIBMPlexSans',
    fallbackStack: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    weights: [
      { weight: 400, fileName: 'ibm-plex-sans-400.woff2' },
      { weight: 700, fileName: 'ibm-plex-sans-700.woff2' },
    ],
  },
  {
    key: 'dmSans',
    label: 'DM Sans',
    dir: 'dm-sans',
    cssFamily: 'InvoicerrBrandDMSans',
    fallbackStack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
    weights: [
      { weight: 400, fileName: 'dm-sans-400.woff2' },
      { weight: 700, fileName: 'dm-sans-700.woff2' },
    ],
  },
  {
    key: 'lora',
    label: 'Lora',
    dir: 'lora',
    cssFamily: 'InvoicerrBrandLora',
    fallbackStack: 'Georgia, "Times New Roman", Times, serif',
    weights: [
      { weight: 400, fileName: 'lora-400.woff2' },
      { weight: 700, fileName: 'lora-700.woff2' },
    ],
  },
];

export function isBrandingFontKey(value: unknown): value is BrandingFontKey {
  return typeof value === 'string' && FONT_CATALOG.some((entry) => entry.key === value);
}

export function fontCatalogEntry(key: string | null | undefined): BrandingFontCatalogEntry | undefined {
  return FONT_CATALOG.find((entry) => entry.key === key);
}

/** The CSS `font-family` value `render-html.ts`'s body rule uses for this key — `cssFamily` followed
 *  by the family's own fallback stack, so even when `fontFaceCssFor` below came back empty (a
 *  missing/corrupted file) the render still ASKS for the named font first, harmlessly falling through
 *  to the fallback when it isn't actually available — never a broken `font-family` declaration.
 *  `null` for an absent/unrecognized key — the caller's own signal to use the pre-branding default
 *  system stack instead (see `render-html.ts`'s own `DEFAULT_BODY_FONT_STACK`). */
export function fontStackFor(key: string | null | undefined): string | null {
  const entry = fontCatalogEntry(key ?? undefined);
  if (!entry) return null;
  return `"${entry.cssFamily}", ${entry.fallbackStack}`;
}

/** Read once per (process, key) — these files never change at runtime, so re-reading and
 *  re-base64-encoding them on every single document render would be pure waste. A failed read is
 *  cached too (as `''`), so a permanently missing/corrupted file doesn't retry a filesystem read on
 *  every render either. */
const fontFaceCssCache = new Map<BrandingFontKey, string>();

function readFontFileBase64(dir: string, fileName: string): string | null {
  try {
    const filePath = join(__dirname, '..', 'fonts', dir, fileName);
    return readFileSync(filePath).toString('base64');
  } catch (err) {
    logger.warn('Branding font file unreadable — falling back to the system font stack', {
      category: 'documents',
      details: { dir, fileName, message: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
}

/**
 * Inlines this family's `.woff2` files as `@font-face` rules with `data:` URIs — see
 * `fonts/LICENSES.md`'s own "Loading" section for why a data URI, never a file path or URL, is the
 * only thing `render-pdf.ts`'s `page.setContent(html, { waitUntil: 'domcontentloaded' })` can
 * reliably load (that pipeline fetches nothing external, ever — this keeps it that way).
 *
 * Returns `''` for an absent/unrecognized key, or when EVERY weight failed to read — never throws:
 * a missing/corrupted bundled font file is a presentation nicety lost, never a reason a document
 * fails to render (the body still gets a real font via `fontStackFor`'s own fallback stack).
 */
export function fontFaceCssFor(key: string | null | undefined): string {
  if (!isBrandingFontKey(key)) return '';

  const cached = fontFaceCssCache.get(key);
  if (cached !== undefined) return cached;

  const entry = fontCatalogEntry(key) as BrandingFontCatalogEntry;
  const rules = entry.weights
    .map((w) => {
      const base64 = readFontFileBase64(entry.dir, w.fileName);
      if (!base64) return null;
      return (
        `@font-face { font-family: "${entry.cssFamily}"; font-style: normal; font-weight: ${w.weight}; ` +
        `font-display: swap; src: url(data:font/woff2;base64,${base64}) format('woff2'); }`
      );
    })
    .filter((rule): rule is string => rule !== null);

  const css = rules.join('\n');
  fontFaceCssCache.set(key, css);
  return css;
}
