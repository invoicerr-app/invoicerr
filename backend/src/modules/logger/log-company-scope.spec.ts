/**
 * Guards the write side of `Log.companyId` (`schema.prisma`'s own comment on the column,
 * `@/logger/logger.service.ts`'s header) against the ONE mistake shape that would silently defeat
 * per-company log filtering: a call site inside a company-scoped request/job that FORCES
 * `companyId: null` — rather than simply omitting the field, which correctly inherits whatever company
 * `@/lib/request-context.ts`'s `AsyncLocalStorage` currently holds. A static scan alone cannot catch
 * this the way `dangling-file-references.spec.ts` catches a stale path citation: "is a company active
 * right here" is a RUNTIME fact (which request, which job, which await depth), not something visible
 * from a file's own text. So this file pairs the two techniques that together DO cover it:
 *
 *  1. A RUNTIME tripwire, already built into `LoggerService#createLog` itself (test-env only — see that
 *     file's own header): any call anywhere in the app that reaches `createLog` with an explicit
 *     `companyId: null` while `getContextCompanyId()` reports an active company throws immediately,
 *     failing whichever test happened to exercise that code path loudly rather than writing a
 *     mis-scoped row. The tests below exercise that tripwire directly, reproducing the exact defect
 *     shape (`companyId: null` hardcoded inside an active-company context) and proving it is caught —
 *     the "spec that reproduces the defect, then passes" this whole mechanism was built against.
 *  2. A STATIC sweep (below), because the runtime tripwire above only ever fires for a code path some
 *     test actually EXERCISES inside an active-company context — a new call site added with a
 *     hardcoded `companyId: null` might never be caught by 1) if nothing happens to test it that way.
 *     This sweep instead scans every `.ts` file under `backend/src` (excluding specs, which are
 *     allowed to construct this exact shape on purpose, and this file itself, which has to describe the
 *     pattern in its own header without tripping on its own explanation) for the literal text
 *     `companyId: null` appearing near a `logger.` call, and requires a `// INSTANCE-LEVEL-LOG: <reason>`
 *     comment immediately above it — forcing a future author to either omit the field (the ordinary,
 *     correct choice) or write, right at the call site, a one-line reason why no company could ever
 *     apply there, the same "an explicit exception, never a silent one" discipline this codebase already
 *     holds for other closed catalogs.
 *
 *     This used to be a `file:line` allowlist kept in this spec file instead. It broke twice in two
 *     days, both times because an UNRELATED edit elsewhere in the same source file shifted every line
 *     number below the edit — never because a real unreviewed call site had appeared. Keying on a
 *     marker comment physically attached to the reviewed call fixes that at the root: the marker moves
 *     WITH the code it excuses, so it survives any edit that does not touch the call itself, and the
 *     reason lives where a reader of that code actually sees it, not in a list in a different directory.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { runWithCompanyId } from '@/lib/request-context';

import { logger } from '@/logger/logger.service';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { log: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) } },
}));

describe('LoggerService — the tripwire itself, exercised directly', () => {
  it('reproduces the defect (a copy-pasted "instance" call site inside a company-scoped one) and catches it', async () => {
    async function actionHandlerThatForgotItHadACompany(): Promise<void> {
      // The exact shape a developer might paste from a genuinely instance-level boot log without
      // noticing this code path is actually running inside `runAction` for a real company.
      await logger.error('Document action declared but not implemented', {
        category: 'documents',
        companyId: null,
      });
    }

    await expect(runWithCompanyId('company-42', actionHandlerThatForgotItHadACompany)).rejects.toThrow(
      /explicitly set companyId: null/,
    );
  });

  it('the correct fix — omitting the field instead — passes cleanly', async () => {
    async function actionHandlerFixed(): Promise<void> {
      await logger.error('Document action declared but not implemented', { category: 'documents' });
    }

    await expect(runWithCompanyId('company-42', actionHandlerFixed)).resolves.not.toThrow();
  });

  it('a genuinely instance-level call (no active company at all) is unaffected either way', async () => {
    await expect(
      logger.warn('MAIL_PROVIDER is "smtp" but SMTP_HOST is empty', { category: 'mail', companyId: null }),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------
// Static sweep — see this file's own header for why the runtime tripwire above needs this companion.

const BACKEND_SRC = resolve(__dirname, '..', '..');
const LOGGER_CALL_RE = /\blogger\.(?:info|warn|error|debug)\(/;

/** The review marker itself: a `// INSTANCE-LEVEL-LOG: <reason>` comment, reason required to be at
 *  least 15 characters (`\S.{14,}`) so an empty or throwaway tag ("// INSTANCE-LEVEL-LOG: n/a") cannot
 *  pass as a real review — see the "rejects a marker whose reason is too short" test below for the
 *  exact boundary this enforces. Deliberately single-line (`.` never matches a newline without the
 *  `s` flag, which this pattern does not set): a real reason fits in one line, matching the "one-line
 *  reason" this codebase's other closed-catalog exceptions already require. */
const MARKER_RE = /\/\/\s*INSTANCE-LEVEL-LOG:\s*(\S.{14,})/;

/** How far a marker may sit BEFORE the `companyId: null` it excuses and still count as covering it —
 *  comments precede the code they explain in this codebase, never follow it, so this is a backward-only
 *  window. 600 characters is deliberately generous relative to the longest real gap measured by hand
 *  across every reviewed site today (419 characters, `default-locale.ts`'s own multi-line templated
 *  message) while staying far short of the gap between two DIFFERENT reviewed sites in the same file
 *  (over 1000 characters in every case checked) — so a marker can never be mistaken for covering the
 *  WRONG call. */
const MARKER_PROXIMITY_WINDOW = 600;

interface Finding {
  file: string;
  line: number;
  index: number;
}

interface Marker {
  file: string;
  line: number;
  index: number;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** A `companyId: null` literal counts only when the SAME call expression also contains a `logger.*(`
 *  call — found by scanning outward from each `companyId: null` match for the nearest enclosing
 *  `logger.` call opened within the previous few lines, rather than a whole-file substring match that
 *  would also flag an unrelated `companyId: null` in, say, a plain data fixture. A window of 400
 *  characters comfortably covers this codebase's own longest `logger.*()` call bodies (checked by hand
 *  against the largest ones in `webhook-handlers.ts`/`customer-provisioning.ts`) without reaching into
 *  the PREVIOUS unrelated statement. Takes `(relativePath, text)` rather than reading the filesystem
 *  itself, so the "deliberately introduce the defect" tests below can drive it against a synthetic
 *  string instead of a real file under `backend/src`. */
function findCompanyIdNullNearLoggerCalls(relativePath: string, text: string): Finding[] {
  const findings: Finding[] = [];
  let searchFrom = 0;
  for (;;) {
    const idx = text.indexOf('companyId: null', searchFrom);
    if (idx === -1) break;
    searchFrom = idx + 'companyId: null'.length;

    const windowStart = Math.max(0, idx - 400);
    if (LOGGER_CALL_RE.test(text.slice(windowStart, idx))) {
      findings.push({ file: relativePath, line: lineOf(text, idx), index: idx });
    }
  }
  return findings;
}

/** Every `// INSTANCE-LEVEL-LOG: <reason>` marker in one file's text — same synthetic-text-friendly
 *  shape as `findCompanyIdNullNearLoggerCalls` above, for the same reason. */
function findInstanceLevelLogMarkers(relativePath: string, text: string): Marker[] {
  const markers: Marker[] = [];
  const re = new RegExp(MARKER_RE, 'g'); // a fresh stateful instance per call — MARKER_RE itself has no 'g'
  let match: RegExpExecArray | null = re.exec(text);
  while (match !== null) {
    markers.push({ file: relativePath, line: lineOf(text, match.index), index: match.index });
    match = re.exec(text);
  }
  return markers;
}

/** Pairs findings with markers by physical proximity within the SAME file's text — a marker "covers"
 *  a finding when it sits no more than `MARKER_PROXIMITY_WINDOW` characters BEFORE it. Returns the two
 *  failure shapes this whole mechanism exists to catch: `unmarked` (a `companyId: null` with no
 *  reviewing comment — a new, unreviewed exception) and `staleMarkers` (a reviewing comment with no
 *  `companyId: null` near it any more — a reviewed exception that has outlived the call it excused,
 *  the marker-based equivalent of the old allowlist's "entry no longer resolves" check). */
function analyzeCompanyIdNullUsage(
  relativePath: string,
  text: string,
): { unmarked: Finding[]; staleMarkers: Marker[] } {
  const findings = findCompanyIdNullNearLoggerCalls(relativePath, text);
  const markers = findInstanceLevelLogMarkers(relativePath, text);

  const covers = (marker: Marker, finding: Finding) =>
    marker.index < finding.index && finding.index - marker.index <= MARKER_PROXIMITY_WINDOW;

  const unmarked = findings.filter((f) => !markers.some((m) => covers(m, f)));
  const staleMarkers = markers.filter((m) => !findings.some((f) => covers(m, f)));
  return { unmarked, staleMarkers };
}

function listTsFiles(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listTsFiles(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Runs `analyzeCompanyIdNullUsage` over every real `.ts` file under `backend/src` (excluding specs,
 *  which `listTsFiles` already drops — see that function's own use above, and this file's own header
 *  for why this spec never trips on its own explanatory prose). */
function analyzeRealTree(): { unmarked: Finding[]; staleMarkers: Marker[] } {
  const unmarked: Finding[] = [];
  const staleMarkers: Marker[] = [];
  for (const absolutePath of listTsFiles(BACKEND_SRC, [])) {
    const relativePath = relative(BACKEND_SRC, absolutePath);
    const result = analyzeCompanyIdNullUsage(relativePath, readFileSync(absolutePath, 'utf8'));
    unmarked.push(...result.unmarked);
    staleMarkers.push(...result.staleMarkers);
  }
  return { unmarked, staleMarkers };
}

describe('no undocumented companyId: null next to a logger call under backend/src', () => {
  it('every companyId: null adjacent to a logger.*() call carries an INSTANCE-LEVEL-LOG marker', () => {
    const { unmarked } = analyzeRealTree();
    if (unmarked.length === 0) return;

    const report = unmarked.map((f) => `  ${f.file}:${f.line}`).join('\n');
    throw new Error(
      `Found ${unmarked.length} logger.*() call passing companyId: null explicitly with no ` +
        `"// INSTANCE-LEVEL-LOG: <reason>" comment covering it:\n${report}\n\n` +
        'Fix: if this call site runs inside a company-scoped request/job, OMIT companyId entirely — it ' +
        'will inherit the active company automatically (@/lib/request-context.ts). If it is genuinely ' +
        'instance-level (no company could ever apply), add a one-line `// INSTANCE-LEVEL-LOG: <reason>` ' +
        'comment directly above the call, stating why no company could ever apply there.',
    );
  });

  it('every INSTANCE-LEVEL-LOG marker still covers a real companyId: null call (catches a stale marker)', () => {
    const { staleMarkers } = analyzeRealTree();
    if (staleMarkers.length === 0) return;

    const report = staleMarkers.map((m) => `  ${m.file}:${m.line}`).join('\n');
    throw new Error(
      `Found ${staleMarkers.length} "INSTANCE-LEVEL-LOG" marker(s) with no companyId: null logger call ` +
        `near them any more — the reviewed call was removed, fixed, or moved out of reach since. Remove ` +
        `the stale marker(s):\n${report}`,
    );
  });
});

// ---------------------------------------------------------------------------------------------------
// Proof that the sweep actually catches both failure shapes — against SYNTHETIC source text, never the
// real tree (deliberately introducing either defect into `backend/src` itself to prove this would be
// the exact mistake this whole file exists to prevent).

describe('marker-based review — proven against synthetic source text', () => {
  const FAKE_FILE = 'modules/fake/fake.service.ts';

  it('flags a companyId: null next to a logger call with no marker at all (a new, unreviewed site)', () => {
    const text = [
      'function f() {',
      "  logger.warn('something happened', { category: 'x', companyId: null });",
      '}',
    ].join('\n');

    const { unmarked, staleMarkers } = analyzeCompanyIdNullUsage(FAKE_FILE, text);
    expect(unmarked).toHaveLength(1);
    expect(staleMarkers).toHaveLength(0);
  });

  it('flags a marker whose companyId: null call was since removed (a reviewed exception gone stale)', () => {
    const text = [
      'function f() {',
      '  // INSTANCE-LEVEL-LOG: this used to be instance-level, but the field was dropped later.',
      "  logger.warn('something happened', { category: 'x' });",
      '}',
    ].join('\n');

    const { unmarked, staleMarkers } = analyzeCompanyIdNullUsage(FAKE_FILE, text);
    expect(unmarked).toHaveLength(0);
    expect(staleMarkers).toHaveLength(1);
  });

  it('accepts a companyId: null immediately covered by a proper marker (the reviewed, correct shape)', () => {
    const text = [
      'function f() {',
      '  // INSTANCE-LEVEL-LOG: genuinely instance-wide, no company could ever apply here.',
      "  logger.warn('something happened', { category: 'x', companyId: null });",
      '}',
    ].join('\n');

    const { unmarked, staleMarkers } = analyzeCompanyIdNullUsage(FAKE_FILE, text);
    expect(unmarked).toHaveLength(0);
    expect(staleMarkers).toHaveLength(0);
  });

  it('rejects a marker whose reason is too short to be a real explanation, treating the site as unmarked', () => {
    const text = [
      'function f() {',
      '  // INSTANCE-LEVEL-LOG: no.',
      "  logger.warn('something happened', { category: 'x', companyId: null });",
      '}',
    ].join('\n');

    const { unmarked, staleMarkers } = analyzeCompanyIdNullUsage(FAKE_FILE, text);
    expect(unmarked).toHaveLength(1);
    expect(staleMarkers).toHaveLength(0);
  });
});
