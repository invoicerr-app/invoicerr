/**
 * REPRODUCTION — P1 evidence question (audit/compliance-truth)
 *
 * Question: does `AUTHORITY_RANGE` merely produce dead code for Mexico, or does it actually BLOCK
 * issuance? The distinction decides whether MX-D1 is technical debt or real user damage — the
 * mechanism it models (an authority-allocated folio range) was abrogated with the CFD/CBB regimes,
 * and the SAT schema vendored in this repo declares `Serie` and `Folio` as use="optional".
 *
 * Runs the real ComplianceService.issue() path. ComplianceService defaults to an in-memory document
 * store, so this needs no database and touches nothing.
 *
 * Run: cd backend && npx tsx ../scripts/audit/repro/f019-mx-authority-range-block.ts
 */
import { ComplianceService } from '../../../backend/src/compliance/operations/compliance-service';
import { resolve as resolvePlan } from '../../../backend/src/compliance/engine/compliance-engine';
import {
  NumberingRegistry,
  defaultNumberingRegistry,
} from '../../../backend/src/compliance/lifecycle/numbering';
import { defaultAuthorityRangeSource } from '../../../backend/src/compliance/lifecycle/authority-range-source';
import { RecordingComplianceLogger } from '../../../backend/src/compliance/execution/logger';
import { InMemoryComplianceDocumentStore } from '../../../backend/src/compliance/operations/document-store';
import type {
  PartyTaxProfile,
  TransactionContext,
} from '../../../backend/src/compliance/canonical/canonical-document';
import type { PartyRole, SupplyType } from '../../../backend/src/compliance/types';

const line = (s = '') => process.stdout.write(`${s}\n`);

function party(country: string, role: PartyRole = 'B2B'): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: [{ scheme: 'VAT', value: `${country}123456789`, validated: true }],
  };
}
function tx(supplier: string, buyer: string): TransactionContext {
  return {
    supplier: party(supplier),
    buyer: party(buyer),
    lines: [
      { id: 'l1', description: 'audit', quantity: 1, unitNetMinor: 100000, supplyType: 'SERVICES' as SupplyType },
    ],
    issueDate: new Date('2026-10-01'),
    currency: 'MXN',
    supplierCompanyId: 'audit-company',
  };
}

async function main() {
  // ── A. what the profile selects, and what the default range source can supply ──────
  line('== A. Le modèle sélectionné pour le Mexique, et la source de plages par défaut ==');
  const ctx = tx('MX', 'MX');
  const plan = resolvePlan(ctx);
  line(`   plan.numbering.model : ${plan.numbering.model}`);
  const series = `${ctx.supplier.countryCode}-INVOICE`;
  const range = await defaultAuthorityRangeSource.getRange(ctx.supplierCompanyId, series);
  line(`   defaultAuthorityRangeSource.getRange(…) : ${JSON.stringify(range)}`);
  line(`   classe : ${defaultAuthorityRangeSource.constructor.name}`);
  line();

  // ── B. the numberer in isolation ──────────────────────────────────────────────────
  line('== B. FolioPool.next() sans plage chargée ==');
  const reg = new NumberingRegistry();
  await reg.ensureRange('AUTHORITY_RANGE', ctx.supplierCompanyId, series, new RecordingComplianceLogger());
  try {
    const n = reg.get('AUTHORITY_RANGE').next(series, plan.numbering, new RecordingComplianceLogger());
    line(`   numéro attribué : ${JSON.stringify(n)} — PAS de blocage`);
  } catch (e) {
    line(`   LÈVE : ${e instanceof Error ? e.message : String(e)}`);
  }
  line();

  // ── C. the real issuance path ─────────────────────────────────────────────────────
  line('== C. ComplianceService.issue() — le vrai chemin d’émission ==');
  const log = new RecordingComplianceLogger();
  // Fresh numbering registry so this run cannot inherit a pool loaded elsewhere in-process.
  // Own the store so the record can be re-read after the throw (the service exposes no getter).
  const store = new InMemoryComplianceDocumentStore();
  const svc = new ComplianceService({ store, numbering: new NumberingRegistry(), logger: log });
  const draft = await svc.createDraft(ctx, 'INVOICE');
  line(`   brouillon créé : ${draft.id} (statut ${draft.status})`);
  let blocked = false;
  try {
    const res = await svc.issue(draft.id);
    line(`   ÉMIS : numéro ${JSON.stringify(res.document.number)} — aucun blocage`);
  } catch (e) {
    blocked = true;
    line(`   ÉMISSION BLOQUÉE : ${e instanceof Error ? e.message : String(e)}`);
  }
  const after = await store.get(draft.id);
  line(`   statut après tentative : ${after?.status}`);
  line(`   événements : ${JSON.stringify((after?.events ?? []).map((e) => e.type))}`);
  line();

  // ── D. control: the same path for a GAPLESS_SELF country ──────────────────────────
  line('== D. Contrôle — le même chemin pour un pays GAPLESS_SELF (France) ==');
  const svcFr = new ComplianceService({ numbering: new NumberingRegistry(), logger: new RecordingComplianceLogger() });
  const draftFr = await svcFr.createDraft(tx('FR', 'FR'), 'INVOICE');
  try {
    const res = await svcFr.issue(draftFr.id);
    line(`   ÉMIS : numéro ${JSON.stringify(res.document.number)}`);
  } catch (e) {
    line(`   BLOQUÉ : ${e instanceof Error ? e.message : String(e)}`);
  }
  line();

  line('== VERDICT ==');
  line(
    blocked
      ? "   AUTHORITY_RANGE ne produit pas du code mort : il BLOQUE toute émission mexicaine,\n" +
        "   avec la configuration par défaut, tant qu'une plage de folios n'est pas saisie —\n" +
        '   or cette plage n’existe pas dans le régime CFDI (Serie et Folio sont use="optional").'
      : '   AUTHORITY_RANGE ne bloque pas : le finding reste de la dette, pas du dégât utilisateur.',
  );
}

void main();
