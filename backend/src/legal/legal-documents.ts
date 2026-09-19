/**
 * Loads and parses the six legal documents this repo ships (`documentation/docs/legal/*.md`,
 * mirrored — see `scripts/sync-legal-docs.ts` and `docs-sync.spec.ts` — onto `./data/*.md`, embedded
 * into the API at build time via `nest-cli.json`'s `**\/*.md` asset rule). Framework-agnostic: no
 * Prisma, no Nest — `legal.service.ts` (HTTP) and `legal-acceptance.ts` (called from both Nest and
 * `lib/auth.ts`, which has no DI container at all) both read through this one module so the two never
 * derive "which version is current" from two different places.
 *
 * Front matter is a handful of flat `key: value` lines, never nested YAML — a five-line regex parser
 * here is proportionate; pulling in a YAML dependency for two required string fields would not be.
 *
 * ## Translations
 *
 * A document's own file (`<slug>.md`) is always English — the sole source `version`/`effectiveDate`/
 * `contentHash` are ever computed from (decision 2026-09-19, owner + counsel: a translation is
 * provided for comprehension, per GDPR Art. 12/WP260 and, for French readers, loi Toubon art. 2 — see
 * the "Governing Language" section every document now carries — but it is never itself the text an
 * acceptance or a release is keyed on; only the wording actually agreed to matters, and that is always
 * the English one). A SIBLING file `<slug>.<lang>.md` (`<lang>` one of `LEGAL_DOCUMENT_LANGUAGES` minus
 * `'en'`) is a translation of that same document, attached to it as `translations[<lang>]` rather than
 * listed as its own top-level `LegalDocument` — `legal-document-view.ts#resolveLegalDocumentView` is
 * the one place that picks which of a document's own text (English, or one of its translations) a
 * given request actually sees.
 *
 * Not every slug has a translation into every language: `terms-of-service`, `legal-notice`, and
 * `cookies-and-acceptable-use` only ship French so far; `privacy-policy` and `data-processing-
 * agreement` ship all five non-English languages (owner decision 2026-09-19 — the two documents GDPR
 * Art. 12 most directly governs). A missing translation is not an error at load time — a slug simply
 * has fewer keys in its `translations` map — so adding the sixth language for one more slug is a matter
 * of dropping one more file in, never a schema change.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { LegalDocumentLanguage } from './legal-languages';

export interface LegalDocumentTranslation {
  language: LegalDocumentLanguage;
  title: string;
  /** Markdown body, front matter stripped — same shape/contract as `LegalDocument.content` below. */
  content: string;
}

export interface LegalDocument {
  slug: string;
  title: string;
  version: string;
  effectiveDate: string;
  sidebarPosition: number;
  /** Markdown body, front matter stripped. Raw — never rendered server-side; the frontend renders it
   *  (`markdown-it`, already a frontend dependency) so this API stays framework-agnostic for any other
   *  consumer (a future CLI, a plugin). */
  content: string;
  /** sha256 of `content`, normalized first (see `computeContentHash` below) — the true identity a
   *  `LegalAcceptance` and a `LegalDocumentRelease` are keyed on (decision 2026-09-17). `version` is
   *  free text an author sets by hand and nothing stops two real wording changes landing under the
   *  same version string the same day; the hash can't be fooled that way. Computed from the ENGLISH
   *  `content` only — see this module's own "Translations" note above for why a translated wording,
   *  however different its bytes, must never move this hash. */
  contentHash: string;
  /** This document's own translations, keyed by language — never including `'en'` (that is `content`/
   *  `title` above, not an entry here). Empty for a slug with no translation at all. */
  translations: Partial<Record<LegalDocumentLanguage, LegalDocumentTranslation>>;
}

/**
 * The two documents the sign-up checkbox ("I accept the Terms of Service and the Privacy Policy")
 * and the sign-in re-acceptance interstitial track. The other four (Data Processing Agreement,
 * Legal Notice, Cookies & Acceptable Use, International Access Transparency) are reference material —
 * reachable at
 * `GET /api/legal/documents` like every document, but accepting them is never required: nothing in
 * the product asks a User to tick a DPA or a legal notice, the same way `terms-of-service.md`'s own
 * Section 9.1 treats the DPA's subject-matter as something the Terms already fold in for the
 * controller relationship, with the Customer as the controller for the processor relationship.
 */
export const REQUIRED_ACCEPTANCE_SLUGS = ['terms-of-service', 'privacy-policy'] as const;

const DATA_DIR = join(__dirname, 'data');

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const FIELD_RE = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/;
const REQUIRED_FIELDS = ['title', 'version', 'effectiveDate'] as const;

function parseFrontMatter(
  raw: string,
  filename: string,
): { fields: Record<string, string>; content: string } {
  const match = raw.match(FRONT_MATTER_RE);
  if (!match) {
    throw new Error(
      `legal-documents: "${filename}" has no front-matter block (expected a leading "---" block)`,
    );
  }
  const [, block, content] = match;
  const fields: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const fieldMatch = line.match(FIELD_RE);
    if (!fieldMatch) continue;
    const [, key, rawValue] = fieldMatch;
    fields[key] = rawValue.trim().replace(/^['"]|['"]$/g, '');
  }
  return { fields, content: content.trim() };
}

/**
 * Normalizes a document body before hashing so the hash reflects wording, never incidental
 * formatting noise: CRLF/CR collapsed to LF (a Windows checkout of the same text must hash
 * identically to a Unix one — the front matter block is already stripped by `parseFrontMatter`, so
 * only the body's own line endings matter here), trailing whitespace stripped from every line (a
 * trailing space a markdown linter would silently fix must not register as a content change), and
 * the whole result trimmed (leading/trailing blank lines are formatting, not wording).
 */
function normalizeForHash(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

/** sha256 hex digest of `content`'s normalized form — exported so `legal-acceptance.spec.ts` and
 *  `legal-release-boot.service.spec.ts` can assert stability (same text, different line endings,
 *  hashes identically) without duplicating the normalization rule. */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(normalizeForHash(content), 'utf-8').digest('hex');
}

/** Matches a translation sibling (`<slug>.<lang>.md`) and captures both groups — never matches a
 *  canonical file, whose name has no language segment before `.md` at all. `<lang>` is intentionally
 *  the same four-non-English-code alternation as `LEGAL_DOCUMENT_LANGUAGES` minus `'en'`, spelled out
 *  rather than built from that array: a `RegExp` built from a `const` array read at import time is not
 *  meaningfully more maintainable than four literal codes for a set this small and this stable, and
 *  spelling it out keeps this file readable without jumping to `legal-languages.ts` to know what it
 *  matches. */
const TRANSLATION_FILENAME_RE = /^(.+)\.(fr|de|it|pl|pt)\.md$/;

function loadDocument(filename: string): LegalDocument {
  const slug = filename.replace(/\.md$/, '');
  const raw = readFileSync(join(DATA_DIR, filename), 'utf-8');
  const { fields, content } = parseFrontMatter(raw, filename);

  for (const required of REQUIRED_FIELDS) {
    if (!fields[required]) {
      throw new Error(`legal-documents: "${filename}" is missing required front-matter field "${required}"`);
    }
  }

  return {
    slug,
    title: fields.title,
    version: fields.version,
    effectiveDate: fields.effectiveDate,
    sidebarPosition: Number(fields.sidebar_position ?? '0'),
    content,
    contentHash: computeContentHash(content),
    translations: {},
  };
}

/**
 * A translation only ever needs `title` — `version`/`effectiveDate`/`sidebar_position` all live on the
 * canonical English document (this module's own "Translations" header above), and a translation is
 * never itself hashed, so it carries none of the fields that exist only to feed
 * `REQUIRED_FIELDS`/`computeContentHash`.
 *
 * `language` in front matter is OPTIONAL, but when present it must agree with the filename's own
 * `<lang>` segment — a deliberate, cheap cross-check (the same "provenance the loader itself verifies"
 * posture CLAUDE.md's documents-module catalogs all take) against the one copy-paste mistake this
 * format invites: pasting `privacy-policy.de.md`'s front matter into `privacy-policy.it.md` without
 * updating the `language:` line inside it.
 */
function loadTranslation(filename: string, lang: LegalDocumentLanguage): LegalDocumentTranslation {
  const raw = readFileSync(join(DATA_DIR, filename), 'utf-8');
  const { fields, content } = parseFrontMatter(raw, filename);

  if (!fields.title) {
    throw new Error(`legal-documents: "${filename}" is missing required front-matter field "title"`);
  }
  if (fields.language && fields.language !== lang) {
    throw new Error(
      `legal-documents: "${filename}"'s front-matter "language: ${fields.language}" does not match the ` +
        `"${lang}" its own filename names`,
    );
  }

  return { language: lang, title: fields.title, content };
}

/**
 * Re-reads `./data/*.md` on every call rather than caching — a few dozen small files even with every
 * translation counted, never on a hot path (a document list page, a sign-up screen, a sign-in
 * interstitial), and NOT caching is what keeps a spec free to assert against the files on disk without
 * a module-cache reset between cases.
 */
export function listLegalDocuments(): LegalDocument[] {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.md'));
  const canonicalFiles = files.filter((f) => !TRANSLATION_FILENAME_RE.test(f));
  const translationFiles = files.filter((f) => TRANSLATION_FILENAME_RE.test(f));

  const docs = canonicalFiles.map(loadDocument);
  const bySlug = new Map(docs.map((doc) => [doc.slug, doc]));

  for (const filename of translationFiles) {
    const match = filename.match(TRANSLATION_FILENAME_RE);
    if (!match) continue; // unreachable — `translationFiles` was just filtered by this same regex.
    const [, slug, lang] = match;
    const doc = bySlug.get(slug);
    if (!doc) {
      throw new Error(
        `legal-documents: translation "${filename}" has no canonical "${slug}.md" to attach to`,
      );
    }
    doc.translations[lang as LegalDocumentLanguage] = loadTranslation(
      filename,
      lang as LegalDocumentLanguage,
    );
  }

  return docs.sort((a, b) => a.sidebarPosition - b.sidebarPosition);
}

export function getLegalDocument(slug: string): LegalDocument | undefined {
  return listLegalDocuments().find((d) => d.slug === slug);
}

/** `undefined` for an unknown slug — callers treat that as "nothing to accept/compare", never as an
 *  error (see `legal-acceptance.ts`'s own header on why an unknown slug is skipped, not thrown). */
export function currentVersionOf(slug: string): string | undefined {
  return getLegalDocument(slug)?.version;
}

/** The hash-based sibling of `currentVersionOf` — see `LegalDocument.contentHash`'s own comment for
 *  why acceptance/release comparisons are keyed on this rather than on `version`. */
export function currentContentHashOf(slug: string): string | undefined {
  return getLegalDocument(slug)?.contentHash;
}
