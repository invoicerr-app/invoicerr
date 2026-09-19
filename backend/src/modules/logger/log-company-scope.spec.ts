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
 *     `companyId: null` appearing near a `logger.` call, and fails, by file:line, on anything not on the
 *     REVIEWED_INSTANCE_LEVEL_CALL_SITES allowlist below — forcing a future author to either omit the
 *     field (the ordinary, correct choice) or add themselves to that allowlist with a one-line reason,
 *     the same "an explicit exception, never a silent one" discipline this codebase already holds for
 *     other closed catalogs.
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

/** Every reviewed, deliberate `companyId: null` next to a `logger.*()` call in non-spec `backend/src` —
 *  empty today (2026-09-17: no such call site exists; every current write site either omits the field,
 *  inheriting the ambient context, or passes a real, resolved companyId — see
 *  `logger.service.ts`'s own header for the two documented instance-level examples, NEITHER of which
 *  goes through `logger.*()` with a literal null: `MailService`'s SMTP_HOST warning and
 *  `documents.service.ts#onModuleInit`'s undeclared-status check both simply OMIT `companyId`, letting
 *  it resolve to null from having no ambient context at all, which is the ordinary, unlisted path this
 *  sweep never flags). Keyed `relativePath:line` so an entry stays valid across an unrelated edit
 *  elsewhere in the same file, and goes stale (caught by the "entry no longer resolves" check below) the
 *  moment the reviewed line itself moves or is deleted. */
const REVIEWED_INSTANCE_LEVEL_CALL_SITES = new Set<string>([
  // instance-reset.service.ts — every one of these five is the "reset the ENTIRE instance" flow
  // (modules/instance/**): genuinely cross-tenant by construction, reached only via
  // InstanceOperatorGuard (never @ActiveCompany()), and the caller may well have some UNRELATED
  // company active in their own session at the time (an instance operator is also, ordinarily, a
  // member of at least one company) — that company must never be the one these lines attribute
  // anything to. The `reset()` method's own two calls (136, 175) additionally run inside an explicit
  // `runWithCompanyId(null, ...)` for the exact same reason — see that method's own doc comment.
  'modules/instance/instance-reset.service.ts:48', // requestOtp — permanent-lockout refusal
  'modules/instance/instance-reset.service.ts:73', // requestOtp — OTP e-mail send failure
  'modules/instance/instance-reset.service.ts:83', // requestOtp — OTP sent successfully
  'modules/instance/instance-reset.service.ts:136', // reset — invalid/expired OTP refusal
  'modules/instance/instance-reset.service.ts:175', // reset — the wipe itself completed
]);

const BACKEND_SRC = resolve(__dirname, '..', '..');
const COMPANY_ID_NULL_NEAR_LOGGER_RE = /\blogger\.(?:info|warn|error|debug)\(/;

interface Finding {
  file: string;
  line: number;
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

/** A `companyId: null` literal counts only when the SAME call expression also contains a `logger.*(`
 *  call — found by scanning outward from each `companyId: null` match for the nearest enclosing
 *  `logger.` call opened within the previous few lines, rather than a whole-file substring match that
 *  would also flag an unrelated `companyId: null` in, say, a plain data fixture. A window of 400
 *  characters comfortably covers this codebase's own longest `logger.*()` call bodies (checked by hand
 *  against the largest ones in `webhook-handlers.ts`/`customer-provisioning.ts`) without reaching into
 *  the PREVIOUS unrelated statement. */
function findCompanyIdNullNearLoggerCalls(): Finding[] {
  const findings: Finding[] = [];
  for (const absolutePath of listTsFiles(BACKEND_SRC, [])) {
    const relativePath = relative(BACKEND_SRC, absolutePath);
    const text = readFileSync(absolutePath, 'utf8');
    let searchFrom = 0;
    for (;;) {
      const idx = text.indexOf('companyId: null', searchFrom);
      if (idx === -1) break;
      searchFrom = idx + 'companyId: null'.length;

      const windowStart = Math.max(0, idx - 400);
      const preceding = text.slice(windowStart, idx);
      if (COMPANY_ID_NULL_NEAR_LOGGER_RE.test(preceding)) {
        const line = text.slice(0, idx).split('\n').length;
        findings.push({ file: relativePath, line });
      }
    }
  }
  return findings;
}

describe('no undocumented companyId: null next to a logger call under backend/src', () => {
  it('every companyId: null adjacent to a logger.*() call is on the reviewed allowlist above', () => {
    const findings = findCompanyIdNullNearLoggerCalls();
    const unreviewed = findings.filter((f) => !REVIEWED_INSTANCE_LEVEL_CALL_SITES.has(`${f.file}:${f.line}`));

    if (unreviewed.length === 0) return;

    const report = unreviewed.map((f) => `  ${f.file}:${f.line}`).join('\n');
    throw new Error(
      `Found ${unreviewed.length} logger.*() call passing companyId: null explicitly, not on the ` +
        `REVIEWED_INSTANCE_LEVEL_CALL_SITES allowlist in this spec:\n${report}\n\n` +
        'Fix: if this call site runs inside a company-scoped request/job, OMIT companyId entirely — it ' +
        'will inherit the active company automatically (@/lib/request-context.ts). If it is genuinely ' +
        'instance-level (no company could ever apply), add "path:line" to the allowlist above with a ' +
        'one-line reason why.',
    );
  });

  it('every allowlisted entry still resolves to a real companyId: null site (catches a stale entry)', () => {
    const findings = new Set(findCompanyIdNullNearLoggerCalls().map((f) => `${f.file}:${f.line}`));
    const stale = [...REVIEWED_INSTANCE_LEVEL_CALL_SITES].filter((entry) => !findings.has(entry));

    if (stale.length === 0) return;
    throw new Error(
      `The allowlist above names ${stale.length} entry(ies) that no longer match any companyId: null ` +
        `call site — the code moved or was fixed since. Remove the stale entry(ies):\n` +
        stale.map((entry) => `  ${entry}`).join('\n'),
    );
  });
});
