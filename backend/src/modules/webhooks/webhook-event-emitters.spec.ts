import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { WebhookEvent } from '../../../prisma/generated/prisma/client';

/**
 * The guard `webhook-event.spec.ts`'s own pin (`EXPECTED_EVENTS`) cannot be: that list is a
 * hand-maintained allowlist — it fails the moment someone REMOVES a value without updating it, but
 * a value ADDED to the enum with no real dispatch call anywhere gets typed straight into that same
 * list by whoever adds it, and the pin passes right along with it. That is exactly how this enum
 * accumulated the 51 dead members purged by `20260903000000_generic_document_webhook_events` and
 * the 79 more purged by `20260903200000_purge_dead_webhook_events` in the first place — a "third
 * debt" purge is only a matter of time without a check that does not trust a hand-typed list at
 * all.
 *
 * This spec re-derives "has a real emitter" the same way both purge migrations' own headers
 * document doing it by hand (grep every `<something>.dispatch(WebhookEvent.X` call site across
 * `backend/src`) — except it runs on every `npm test`, against the CURRENT tree, not a snapshot
 * some prior session typed into a comment. `WebhookDispatcherService.dispatch` and the
 * `DocumentWebhookEmitter.dispatch` interface it satisfies (`documents/queue/document-webhooks.ts`)
 * share the exact same two-positional-argument shape on purpose (see that file's own header), so
 * ONE pattern — `.dispatch(` immediately followed by `WebhookEvent.<MEMBER>`, whitespace/newlines
 * allowed between them — catches every real call site through either name, with no per-file
 * allowlist to keep in sync.
 *
 * Deliberately excludes `*.spec.ts`: a test mocking `{ dispatch: jest.fn() }` and asserting it was
 * called with `WebhookEvent.X` proves the CALLER passes that value, which the production file
 * itself already provides a real match for — counting the spec file too would let a value with
 * ONLY a test double (no production call site at all) slip past this guard.
 *
 * WHAT THIS WON'T CATCH (documented rather than papered over, same discipline
 * `dangling-file-references.spec.ts` uses for its own blind spots): a value built up at runtime
 * from a variable or template string instead of a bare `WebhookEvent.X` literal. Both purge
 * migrations' own headers record that no call site in this codebase has ever done that — every
 * dispatch passes a literal member — so this is a real gap only if a future call site breaks that
 * pattern, not a live one today.
 */

const BACKEND_SRC = resolve(__dirname, '..', '..');

function listProductionSourceFiles(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listProductionSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

const DISPATCH_CALL_RE = /\.dispatch\(\s*WebhookEvent\.([A-Za-z0-9_]+)/g;

function findEmittedEvents(): Set<string> {
  const emitted = new Set<string>();
  for (const file of listProductionSourceFiles(BACKEND_SRC, [])) {
    const text = readFileSync(file, 'utf8');
    DISPATCH_CALL_RE.lastIndex = 0;
    let match = DISPATCH_CALL_RE.exec(text);
    while (match !== null) {
      emitted.add(match[1]);
      match = DISPATCH_CALL_RE.exec(text);
    }
  }
  return emitted;
}

describe('WebhookEvent enum members all have a real emitter', () => {
  it('never carries a member with zero `.dispatch(WebhookEvent.X` call sites in backend/src', () => {
    const emitted = findEmittedEvents();
    const orphaned = Object.values(WebhookEvent).filter((value) => !emitted.has(value));

    if (orphaned.length === 0) return;

    throw new Error(
      `Found ${orphaned.length} WebhookEvent member(s) with no real dispatch call site anywhere in ` +
        `backend/src: ${orphaned.join(', ')}.\n` +
        'Either wire a real `webhookDispatcher.dispatch(WebhookEvent.X, ...)` (or the ' +
        '`DocumentWebhookEmitter` equivalent) call for it, or remove it from the enum the same way ' +
        '`20260903200000_purge_dead_webhook_events` removed its 79 dead siblings — see that ' +
        "migration's own header for the additive-rebuild technique Postgres forces (no ALTER TYPE ... " +
        'DROP VALUE).',
    );
  });
});
