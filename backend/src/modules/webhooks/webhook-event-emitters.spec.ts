import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { WebhookEvent } from '../../../prisma/generated/prisma/client';

/**
 * Proves every WebhookEvent member has a real dispatch call site under `backend/src`, instead of
 * trusting the hand-maintained list in `webhook-event.spec.ts`: a member added with no emitter would
 * otherwise pass that pin. It matches `.dispatch(` immediately followed by the enum member, which
 * catches both `WebhookDispatcherService` and the document emitter's identical signature. Spec files
 * are excluded, since a mocked dispatch proves the caller, not a production emitter.
 *
 * Not caught: a value built at runtime instead of a bare literal.
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
