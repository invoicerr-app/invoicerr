import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import * as ts from 'typescript';

/**
 * Guards against the exact defect a 2026-09-13 sweep found by hand, in eleven separate patterns
 * across dozens of files: a comment citing a file that has since been renamed or deleted (a
 * removed country's format provider, a module rename that outran its own doc comments, a spec
 * moved into a different file). Nobody notices until someone follows the pointer — this test
 * follows every one of them, on every run, instead.
 *
 * SCOPE, DELIBERATELY NARROW — read this before broadening a rule, not after chasing one false
 * positive it let through:
 *
 *  - Scans `backend/src/**\/*.{ts,tsx}`, `backend/prisma/schema.prisma`, `e2e/**\/*.ts`, and
 *    `frontend/src/**\/*.{ts,tsx}` — never `documentation/`, whose own comment-citation habits this
 *    test has not been checked against. `e2e/` and `frontend/` were added the same day this guard
 *    itself was: the very first dangling reference this whole effort found lived in a Cypress spec
 *    under `e2e/`, and this test would not have caught it until this addition.
 *  - Only looks INSIDE comments — via the TypeScript parser's own token trivia, so a `//` inside a
 *    string literal or a URL is never mistaken for a comment start. An import path is already
 *    checked by `tsc` itself and would fail the build long before this test runs.
 *  - Only a candidate containing at least one "/" counts as a path. A bare filename
 *    ("TODO_ISSUES.md", "CLAUDE.md") is how this codebase deliberately cites its own root-level
 *    docs from inside source comments, and is not "unambiguously" one specific file the way a
 *    multi-segment path is — treating it as one would flag dozens of legitimate citations for every
 *    real one.
 *  - A candidate resolves if ANY file this repo currently tracks (or holds, uncommitted, as a plain
 *    working-tree file — `git ls-files -c -o --exclude-standard`) ends with that candidate as a
 *    "/"-delimited suffix. Comments here cite paths several different ways — from the repo root,
 *    from the containing module, sometimes missing an intermediate directory entirely — and a
 *    suffix match tolerates all of them the same way a human skimming the tree would, without
 *    hand-listing which file a given caller "meant".
 *  - Excluded by SHAPE, not by name, because each is a real, recurring pattern rather than one
 *    file: a URL; a glob or placeholder (`*`, `<`, `>`, or this codebase's own `xx` country-code
 *    placeholder, e.g. `data/xx.json`); an npm-scoped package (`@prisma/client`) other than this
 *    repo's own `@/` alias (resolved against the scanned file's own project root — `backend/src/` or
 *    `frontend/src/`; `e2e/` declares no such alias, so a literal `@/` there is left unresolved
 *    rather than guessed at); a generated or gitignored output (`dist/`, `prisma/generated/…`); a
 *    mid-path ellipsis this codebase uses in prose to elide directories it isn't spelling out
 *    (`backend/.../descriptors/invoice.descriptor.ts` — no real file has a literal "..." segment, so
 *    only what follows the LAST one is resolved, the same way a human reads past it); a slash-joined
 *    LIST of filenames
 *    or bare country codes used as shorthand prose ("fr.json/us.json", "fr/it/pl.json",
 *    "fr/it/pl/de/es/mx/us.json") rather than a nested path; and the pre-rewrite module tree this
 *    codebase calls `compliance/…` — cited throughout as permanent git-history lineage ("REPRISE from
 *    `compliance/x.ts` at git tag `avant-refonte-documents`", retrievable forever with
 *    `git show <tag>:<path>`, never a current-tree pointer) and recognised by that tag name or its
 *    established shorthand ("repère", "pre-refonte", "removed compliance") appearing within a small
 *    window of the citation — not the whole comment block, so one such aside near the top of a
 *    file-length header cannot shadow an unrelated, genuinely dangling citation far below it in the
 *    very same block.
 *
 * WHAT THIS STILL WON'T CATCH (found while building it, not papered over with a bigger rule):
 *  - A path split across a JSDoc line-wrap in the middle of a hyphenated word — rare (one instance
 *    found and fixed by hand this sweep) and not worth the risk of merging unrelated wrapped prose.
 *  - A citation that resolves to the WRONG file (a real, unrelated one, or a right-shaped file under
 *    the wrong directory) — this test only proves the path resolves to something, never that it is
 *    the file the sentence around it means.
 *  - A stale factual claim sitting next to an otherwise-valid citation ("only one country mandates
 *    this channel, see `channel-policy/data/fr.json`") — `fr.json` still exists, so nothing here
 *    fires; the claim itself can still be wrong.
 *  - A comment that names a path only to say it does NOT exist ("no `pl.json` ships under
 *    country-identifiers/data"), which this test cannot tell apart from a stale forward-reference to
 *    one that used to — the two comments found this way were reworded (moved the filename off the
 *    slash-joined shape, exactly as in that example) rather than taught to this test as a rule: a
 *    generic "nearby negation" heuristic risks hiding a genuine dangling reference behind whatever
 *    word happened to precede it.
 */

const REPO_ROOT = resolve(__dirname, '..', '..');
const BACKEND_SRC = __dirname;
const SCHEMA_PRISMA = resolve(REPO_ROOT, 'backend', 'prisma', 'schema.prisma');

/** One tracked-file-prefix scan root, besides `backend/src` (walked separately, see
 *  `listSourceFiles`) and `schema.prisma` (its own comment syntax, see `extractPrismaComments`).
 *  `aliasBase` is what this root's own `@/` resolves against — `null` where the root declares no
 *  such alias, so a literal `@/` there is left unresolved rather than guessed at (see the header). */
interface ScanRoot {
  /** Repo-root-relative prefix, trailing slash included, matched against `git ls-files` output. */
  prefix: string;
  extensions: readonly string[];
  aliasBase: string | null;
}

const SCAN_ROOTS: readonly ScanRoot[] = [
  { prefix: 'e2e/', extensions: ['ts'], aliasBase: null },
  { prefix: 'frontend/src/', extensions: ['ts', 'tsx'], aliasBase: 'frontend/src/' },
];

const TARGET_EXTENSIONS = ['ts', 'tsx', 'json', 'sch', 'xsd', 'pem', 'sql', 'md', 'yaml', 'yml'] as const;
const EXTENSION_RE = new RegExp(`\\.(?:${TARGET_EXTENSIONS.join('|')})$`);
const PATH_CANDIDATE_RE = new RegExp(
  `[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+\\.(?:${TARGET_EXTENSIONS.join('|')})\\b`,
  'g',
);
const URL_RE = /https?:\/\/\S+/g;
// This codebase's one established convention for citing its own pre-rewrite module tree as
// permanent git history rather than a current-tree pointer — see the header above.
const LINEAGE_MARKER_RE = /avant-refonte-documents|repère|pre-refonte|removed compliance/;
const LINEAGE_WINDOW = 150;

interface CommentToken {
  /** Character offset of the comment's start within its file, used to compute a line number. */
  start: number;
  text: string;
}

interface Finding {
  file: string;
  line: number;
  candidate: string;
}

function listSourceFiles(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(full, out);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Every file this repo currently holds — committed or not, excluding whatever `.gitignore` already
 *  excludes (so `dist/`, `prisma/generated/…`, `node_modules/` never need a second, hand-maintained
 *  exclusion list here). Used only to RESOLVE candidates, never to decide what to scan. */
function listRepoFiles(): string[] {
  return execSync('git ls-files -c -o --exclude-standard', {
    cwd: REPO_ROOT,
    maxBuffer: 1024 * 1024 * 64,
  })
    .toString('utf8')
    .split('\n')
    .filter(Boolean);
}

/** Every file among `repoFiles` under `root.prefix` with one of `root.extensions` — used to pick scan
 *  TARGETS for `e2e/` and `frontend/src/` (unlike `listSourceFiles`'s filesystem walk for
 *  `backend/src`, filtering the same tracked-or-untracked list `buildResolver` already fetched keeps
 *  `node_modules/`, build output, and Cypress's own `screenshots/`/`videos/`/`downloads/` out for
 *  free — they are exactly what `git ls-files --exclude-standard` already excludes, with no second,
 *  hand-maintained skip list to keep in sync with `.gitignore`). */
function listScanRootFiles(repoFiles: string[], root: ScanRoot): string[] {
  return repoFiles
    .filter((file) => file.startsWith(root.prefix) && root.extensions.some((ext) => file.endsWith(`.${ext}`)))
    .map((file) => resolve(REPO_ROOT, file));
}

function buildResolver(repoFiles: string[]): (candidate: string) => boolean {
  const byBasename = new Map<string, string[]>();
  for (const file of repoFiles) {
    const basename = file.slice(file.lastIndexOf('/') + 1);
    const existing = byBasename.get(basename);
    if (existing) {
      existing.push(file);
    } else {
      byBasename.set(basename, [file]);
    }
  }
  return (candidate: string): boolean => {
    const basename = candidate.slice(candidate.lastIndexOf('/') + 1);
    const sameBasename = byBasename.get(basename);
    if (!sameBasename) return false;
    return sameBasename.some((file) => file === candidate || file.endsWith(`/${candidate}`));
  };
}

/** Repeatedly applies `re` (a global regex) to `text`, returning every match — the one helper every
 *  extraction function below goes through, so `match = re.exec(text)` is assigned exactly once,
 *  never inline inside a `while` condition (biome's own `noAssignInExpressions`, `recommended`). */
function matchAll(re: RegExp, text: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  re.lastIndex = 0;
  let match = re.exec(text);
  while (match !== null) {
    matches.push(match);
    match = re.exec(text);
  }
  return matches;
}

const COMMENT_IN_TRIVIA_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/** Every leaf token in the file, in source order — walking the FULL PARSER's own AST rather than
 *  re-tokenizing by hand. See `extractComments` below for why this matters. */
function collectLeafTokens(node: ts.Node, sourceFile: ts.SourceFile, out: ts.Node[]): ts.Node[] {
  const children = node.getChildren(sourceFile);
  if (children.length === 0) {
    out.push(node);
  } else {
    for (const child of children) collectLeafTokens(child, sourceFile, out);
  }
  return out;
}

/** Every `//` and `/* … *‍/` comment in a `.ts`/`.tsx` file. Deliberately goes through the full
 *  parser (`ts.createSourceFile`) rather than `ts.createScanner` run standalone: a bare scanner
 *  cannot tell a regex literal (`/[*<>]/`) from two division operators without the parser's own
 *  expression context, and gets the rest of the file's tokenization out of sync the moment it
 *  guesses wrong — silently hiding every comment after that point, which is exactly the failure
 *  mode a "did the guard even run" check would never surface (it still exits zero, just having
 *  scanned less than it claims to). Walking the AST's own leaf tokens and reading each one's
 *  leading trivia (`getFullStart()` to `getStart()`) reuses the parser's already-correct
 *  tokenization instead of redoing it. */
function extractComments(fileName: string, sourceText: string): CommentToken[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const comments: CommentToken[] = [];
  for (const token of collectLeafTokens(sourceFile, sourceFile, [])) {
    const triviaStart = token.getFullStart();
    const triviaEnd = token.getStart(sourceFile);
    if (triviaEnd <= triviaStart) continue;
    const trivia = sourceText.slice(triviaStart, triviaEnd);
    for (const match of matchAll(COMMENT_IN_TRIVIA_RE, trivia)) {
      comments.push({ start: triviaStart + match.index, text: match[0] });
    }
  }
  return comments;
}

/** `schema.prisma` only has `//` line comments (no block-comment syntax), so each line is its own
 *  comment token — unlike a JSDoc block, there is no multi-line unit to extract here. */
function extractPrismaComments(sourceText: string): CommentToken[] {
  return matchAll(/\/\/.*$/gm, sourceText).map((match) => ({ start: match.index, text: match[0] }));
}

function lineNumberAt(sourceText: string, position: number): number {
  let line = 1;
  for (let i = 0; i < position; i++) {
    if (sourceText[i] === '\n') line++;
  }
  return line;
}

function findUrlRanges(text: string): Array<[number, number]> {
  return matchAll(URL_RE, text).map((match) => [match.index, match.index + match[0].length]);
}

/** Applies every shape-based exclusion from the header comment. `aliasBase` is the scanned file's own
 *  project root for resolving a leading `@/` (`null` where that root declares no such alias — see
 *  `ScanRoot`). Returns the (possibly normalized) candidate to resolve, or `null` if this match should
 *  never be treated as a repo-relative path. */
function normalizeCandidate(rawCandidate: string, aliasBase: string | null): string | null {
  // A leading run of dot-only segments is either a real relative prefix ("../foo.ts") or a prose
  // ellipsis ("…/foo.ts") — indistinguishable from here, and treated the same way: strip it, then
  // judge what remains on its own merits.
  let candidate = rawCandidate.replace(/^(?:\.+\/)+/, '');

  // A MID-path dot-only segment ("backend/.../descriptors/invoice.descriptor.ts") is this codebase's
  // own convention for eliding an unspecified number of intermediate directories in prose — no real
  // file has a literal "..." path segment, so it can never itself be part of a suffix match. Keep
  // only what follows the LAST such marker; everything before it is context for the reader ("this
  // lives somewhere under backend"), not part of the path to resolve — the same information loss as
  // citing just a file's own nearest directory, which the plain suffix match already tolerates.
  const preEllipsisSegments = candidate.split('/');
  const lastEllipsisIndex = preEllipsisSegments.reduce(
    (lastIndex, segment, index) => (/^\.{2,}$/.test(segment) ? index : lastIndex),
    -1,
  );
  if (lastEllipsisIndex >= 0) {
    candidate = preEllipsisSegments.slice(lastEllipsisIndex + 1).join('/');
  }

  if (!candidate.includes('/')) return null; // bare filename — see header, ambiguous by design
  if (/[*<>]/.test(candidate)) return null; // glob or placeholder syntax
  if (candidate.startsWith('@') && !candidate.startsWith('@/')) return null; // npm-scoped package
  if (/(^|\/)(dist|generated|node_modules|coverage)\//.test(candidate)) return null;

  if (candidate.startsWith('@/')) {
    if (aliasBase === null) return null; // this root declares no `@/` alias — not ours to guess at
    candidate = `${aliasBase}${candidate.slice(2)}`;
  }

  const segments = candidate.split('/');
  const nonFinalSegments = segments.slice(0, -1);
  // "fr.json/us.json" — a slash-joined LIST of filenames, not a nested path.
  if (nonFinalSegments.some((segment) => EXTENSION_RE.test(segment))) return null;
  const finalStem = segments[segments.length - 1].replace(EXTENSION_RE, '');
  // "fr/it/pl.json", "fr/it/pl/de/es/mx/us.json" — a slash-joined list of bare country codes, the
  // extension folded into the last one instead of spelled out for every entry. One real two-letter
  // directory exists in this repo (`formats/vendored/{de,it,pl}`), and it never nests one bare
  // two-letter segment directly inside another the way this enumeration shorthand does — so three or
  // more two-letter-or-stem segments in one candidate (counting the final stem alongside the earlier
  // bare ones, since the shortest form of the list folds its last entry's extension in) is always the
  // shorthand, never a real nested directory chain.
  const bareTwoLetterSegmentCount =
    nonFinalSegments.filter((segment) => /^[a-z]{2}$/.test(segment)).length +
    (/^[a-z]{2}$/.test(finalStem) ? 1 : 0);
  if (bareTwoLetterSegmentCount >= 3) return null;
  // `data/xx.json` — the documented placeholder for "any country's file in this directory".
  if (finalStem.toLowerCase() === 'xx') return null;
  // The pre-rewrite `compliance/…` namespace — see the header comment's own paragraph on why this is
  // a namespace exclusion, not a per-file allowlist.
  if (candidate === 'compliance' || candidate.startsWith('compliance/')) return null;

  return candidate;
}

function findDanglingReferences(): Finding[] {
  const repoFiles = listRepoFiles();
  const resolves = buildResolver(repoFiles);
  const findings: Finding[] = [];

  const scan = (
    absolutePath: string,
    comments: CommentToken[],
    sourceText: string,
    aliasBase: string | null,
  ): void => {
    const relativePath = relative(REPO_ROOT, absolutePath);
    for (const comment of comments) {
      const urlRanges = findUrlRanges(comment.text);
      for (const match of matchAll(PATH_CANDIDATE_RE, comment.text)) {
        const raw = match[0];
        const matchStart = match.index;
        const matchEnd = matchStart + raw.length;
        if (urlRanges.some(([start, end]) => matchStart < end && matchEnd > start)) continue;

        const windowStart = Math.max(0, matchStart - LINEAGE_WINDOW);
        const windowEnd = Math.min(comment.text.length, matchEnd + LINEAGE_WINDOW);
        if (LINEAGE_MARKER_RE.test(comment.text.slice(windowStart, windowEnd))) continue;

        const candidate = normalizeCandidate(raw, aliasBase);
        if (candidate === null) continue;

        if (!resolves(candidate)) {
          findings.push({
            file: relativePath,
            line: lineNumberAt(sourceText, comment.start),
            candidate: raw,
          });
        }
      }
    }
  };

  for (const file of listSourceFiles(BACKEND_SRC, [])) {
    const sourceText = readFileSync(file, 'utf8');
    scan(file, extractComments(file, sourceText), sourceText, 'backend/src/');
  }

  for (const root of SCAN_ROOTS) {
    for (const file of listScanRootFiles(repoFiles, root)) {
      // `listScanRootFiles` reads `git ls-files`, which lists what git TRACKS — including a file that
      // has just been deleted from disk and whose deletion is not staged yet. Reading it blindly then
      // dies with a bare `ENOENT ... folder-select.tsx` from inside a spec whose name is about
      // dangling COMMENT references, which is about as misleading as a failure gets: it reads as
      // "this guard found something" when the guard found nothing and simply could not run. A
      // deleted file has no comments left to check, so skipping it is not a weakened assertion — it
      // is the only honest thing left to do with it.
      if (!existsSync(file)) continue;
      const sourceText = readFileSync(file, 'utf8');
      scan(file, extractComments(file, sourceText), sourceText, root.aliasBase);
    }
  }

  const schemaText = readFileSync(SCHEMA_PRISMA, 'utf8');
  scan(SCHEMA_PRISMA, extractPrismaComments(schemaText), schemaText, 'backend/src/');

  return findings;
}

describe('dangling file references in comments', () => {
  it('never cites, in a backend/src, e2e, frontend/src, or schema.prisma comment, a repository path that does not exist', () => {
    const findings = findDanglingReferences();
    if (findings.length === 0) return;

    const report = findings.map((f) => `  ${f.file}:${f.line} -> ${f.candidate}`).join('\n');
    const fixAdvice = [
      'Fix: either the file was renamed/deleted and the comment is stale (delete the dead pointer,',
      "keep the explanation — see this spec's own header), or the path is a genuine new reference",
      'that needs correcting.',
    ].join(' ');
    throw new Error(
      `Found ${findings.length} comment(s) citing a file path that does not exist in this repository ` +
        `(checked against \`git ls-files -c -o --exclude-standard\`):\n${report}\n\n${fixAdvice}`,
    );
  });
});
