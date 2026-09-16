/**
 * Loads and parses the five legal documents this repo ships (`documentation/docs/legal/*.md`,
 * mirrored — see `scripts/sync-legal-docs.ts` and `docs-sync.spec.ts` — onto `./data/*.md`, embedded
 * into the API at build time via `nest-cli.json`'s `**\/*.md` asset rule). Framework-agnostic: no
 * Prisma, no Nest — `legal.service.ts` (HTTP) and `legal-acceptance.ts` (called from both Nest and
 * `lib/auth.ts`, which has no DI container at all) both read through this one module so the two never
 * derive "which version is current" from two different places.
 *
 * Front matter is a handful of flat `key: value` lines, never nested YAML — a five-line regex parser
 * here is proportionate; pulling in a YAML dependency for two required string fields would not be.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
   *  same version string the same day; the hash can't be fooled that way. */
  contentHash: string;
}

/**
 * The two documents the sign-up checkbox ("I accept the Terms of Service and the Privacy Policy")
 * and the sign-in re-acceptance interstitial track. The other three (Data Processing Agreement,
 * Legal Notice, Cookies & Acceptable Use) are reference material — reachable at
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
  };
}

/**
 * Re-reads `./data/*.md` on every call rather than caching — five small files, never on a hot path
 * (a document list page, a sign-up screen, a sign-in interstitial), and NOT caching is what keeps a
 * spec free to assert against the files on disk without a module-cache reset between cases.
 */
export function listLegalDocuments(): LegalDocument[] {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.md'));
  return files.map(loadDocument).sort((a, b) => a.sidebarPosition - b.sidebarPosition);
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
