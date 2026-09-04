/**
 * FI — direct-load content spec, added by the FI country agent (TODO_DOCUMENTS.md, vague B, lot 5).
 * Same rationale as country-policy/data/se.spec.ts: reads `fi.json` straight off disk rather than
 * through `data/all.ts` (wiring "fi" in is a mandataire decision), and re-runs the exact load-time
 * gate (`assertValidProvenance`) independently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidProvenance, CountryDocumentPolicyFile } from '../schema';

function loadFi(): CountryDocumentPolicyFile {
  const raw = readFileSync(join(__dirname, 'fi.json'), 'utf-8');
  return JSON.parse(raw) as CountryDocumentPolicyFile;
}

describe('FI — country-policy/data/fi.json', () => {
  const fi = loadFi();

  it('declares countryCode FI and a non-empty documentTypes list', () => {
    expect(fi.countryCode).toBe('FI');
    expect(fi.documentTypes?.length).toBeGreaterThan(0);
  });

  it('every rule passes the load-time provenance gate', () => {
    for (const rule of fi.rules) {
      expect(() => assertValidProvenance(rule, 'fi.json (test)')).not.toThrow();
    }
  });

  it('declares exactly the same 22 typeId.actionId pairs as se.json/lv.json/lu.json, no duplicates', () => {
    const pairs = fi.rules.map((r) => `${r.typeId}.${r.actionId}`);
    expect(pairs.length).toBe(22);
    expect(new Set(pairs).size).toBe(22);
  });

  it('pins invoice.save-draft: "legal", restricted to draft, grounded in a TWO-clause composition (209 e §2 sequential invoice identifier + 209 g § authenticity/integrity)', () => {
    const saveDraft = fi.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'save-draft')!;
    expect(saveDraft.allowed).toBe(true);
    expect(saveDraft.statuses).toEqual(['draft']);
    expect(saveDraft.provenance.kind).toBe('legal');
    if (saveDraft.provenance.kind === 'legal') {
      expect(saveDraft.provenance.sourceText).toBe(
        'yhteen tai useampaan sarjaan perustuva juokseva tunniste, jolla lasku voidaan yksilöidä;',
      );
      expect(saveDraft.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    expect(saveDraft.notes).toMatch(/209 g §/);
  });

  it('pins invoice.send: "legal", Laki (241/2019) 4 § — the BUYER\'s right to REQUEST an e-invoice, not a seller consent-gate', () => {
    const send = fi.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'send')!;
    expect(send.provenance.kind).toBe('legal');
    if (send.provenance.kind === 'legal') {
      expect(send.provenance.sourceText).toBe(
        'Hankintayksiköllä ja elinkeinonharjoittajalla on oikeus saada pyynnöstä lasku toiselta hankintayksiköltä tai elinkeinonharjoittajalta sähköisenä laskuna.',
      );
      expect(send.provenance.sourceCheckedAt).toBe('2026-09-04');
    }
    // The headline finding of this lot: FI does NOT gate electronic sending on recipient consent,
    // unlike se.json/lv.json/lu.json's own invoice.send — it grants the RECIPIENT a request-right.
    expect(send.notes).toMatch(/NE conditionne PAS/);
    expect(send.notes).toMatch(/241\/2019/);
  });

  it('pins quote.send to the same eIDAS art. 25 §1 citation SE/LV/LU/NL/EE already carry, copied verbatim (never re-summarized)', () => {
    const quoteSend = fi.rules.find((r) => r.typeId === 'quote' && r.actionId === 'send')!;
    expect(quoteSend.provenance.kind).toBe('legal');
    if (quoteSend.provenance.kind === 'legal') {
      expect(quoteSend.provenance.sourceText).toMatch(/electronic signature shall not be denied/i);
    }
  });

  it('credit-note.send is "legal" via 209 e §18\'s reference-to-the-original clause, but explicitly NOT modeled as a standalone assimilation clause the way se.json/lv.json/lu.json are', () => {
    const creditSend = fi.rules.find((r) => r.typeId === 'credit-note' && r.actionId === 'send')!;
    expect(creditSend.provenance.kind).toBe('legal');
    if (creditSend.provenance.kind === 'legal') {
      expect(creditSend.provenance.sourceText).toBe(
        'jos laskulla muutetaan aikaisemmin annettua laskua, yksiselitteinen viittaus tähän laskuun.',
      );
    }
    expect(creditSend.notes).toMatch(/hyvityslasku/);
    expect(creditSend.notes).toMatch(/allowed/);
  });

  it('export-accounting stays "unverified" and its note reflects the real, checked implementation state (no handler registered)', () => {
    const exportAcc = fi.rules.find((r) => r.typeId === 'invoice' && r.actionId === 'export-accounting')!;
    expect(exportAcc.provenance.kind).toBe('unverified');
    if (exportAcc.provenance.kind === 'unverified') {
      expect(exportAcc.provenance.resolutionNote).toMatch(/intentionally left unregistered/);
    }
  });

  it('file-level notes document the Finlex access asymmetry: full-text ajantasa render for the VAT Act, ToC-only + PDF fallback for the compact e-invoicing act', () => {
    expect(fi.notes).toMatch(/241\/2019/);
    expect(fi.notes).toMatch(/mainPdf/);
    expect(fi.notes).toMatch(/yritys- ja yhteisötietolaki/);
  });
});
