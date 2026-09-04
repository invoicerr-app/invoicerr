/**
 * HU-COMPLEMENT — spec for the ADDITIVE enrichment made to the pre-existing `country-policy/data/
 * hu.json` by the HU-COMPLEMENT country agent (TODO_DOCUMENTS.md, vague B, lot 4). This file does
 * NOT re-test the whole hu.json shape (that already belongs to this module's own general specs,
 * e.g. seed.spec.ts/schema.spec.ts, which run against every shipped country file) — it pins the ONE
 * change this agent made: `invoice.send`'s provenance promoted from `unverified` to `legal`, while
 * `invoice.save-draft` and the file's own DELIBERATELY PARTIAL scope stay untouched.
 *
 * hu.json PRE-DATES this agent (created for the NAV Online Számla reporting scenario, see its own
 * file-level `notes`) — this task read it, found nothing to contradict, and promoted exactly one
 * rule whose citation this task's own primary-source research (net.jogtar.hu, docid=A0700127.TV —
 * see correction-routes/data/hu.json's own file-level note for the access method) happened to
 * settle. Nothing else in hu.json was rewritten.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

function loadHu(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'hu.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

describe('HU-COMPLEMENT — country-policy/data/hu.json (additive enrichment)', () => {
  const hu = loadHu();

  it('still declares exactly the same two rules this file was created with — save-draft and send, nothing added or removed', () => {
    const keys = hu.rules.map((r) => `${r.typeId}.${r.actionId}`).sort();
    expect(keys).toEqual(['invoice.save-draft', 'invoice.send']);
  });

  it('every rule still passes the load-time provenance gate', () => {
    for (const rule of hu.rules) {
      expect(() => assertValidProvenance(rule, 'hu.json (test)')).not.toThrow();
    }
  });

  it('invoice.save-draft is UNTOUCHED — still allowed, still unverified, same reasoning', () => {
    const saveDraft = hu.rules.find((r) => r.actionId === 'save-draft')!;
    expect(saveDraft.allowed).toBe(true);
    expect(saveDraft.provenance.kind).toBe('unverified');
    if (saveDraft.provenance.kind === 'unverified') {
      expect(saveDraft.provenance.resolutionNote).toMatch(/fr\.json.*us\.json|draft/i);
    }
  });

  it('invoice.send was PROMOTED from unverified to legal, sourced to the Áfa tv. 175. § (3) b) buyer-consent clause', () => {
    const send = hu.rules.find((r) => r.actionId === 'send')!;
    expect(send.allowed).toBe(true);
    expect(send.provenance.kind).toBe('legal');
    if (send.provenance.kind === 'legal') {
      expect(send.provenance.sourceText).toMatch(/számlabefogadó beleegyezése/);
      expect(send.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(send.notes).toMatch(/PROMOTED FROM UNVERIFIED/);
    expect(send.notes).toMatch(/175\. § \(3\)/);
  });

  it("the file-level notes documents the promotion as an additive enrichment, still calling out the file's own remaining partiality", () => {
    expect(hu.notes ?? '').toMatch(/ENRICHED 2026-09-04/);
    expect(hu.notes ?? '').toMatch(/PROMOTED/);
    expect(hu.notes ?? '').toMatch(/DELIBERATELY PARTIAL/);
    // The original scope caveat must survive verbatim enough to still name save-draft/send as the
    // only two declared actions — an enrichment that quietly widened the file's own claimed scope
    // would be exactly the kind of silent promotion this module's discipline forbids.
    expect(hu.notes ?? '').toMatch(/invoice\.save-draft.*invoice\.send|save-draft.*send/);
  });
});
