/**
 * REPRODUCTION — F-001 / F-002 / F-003 (audit/compliance-truth, phase 1 point 1)
 *
 * Run: cd backend && COMPLIANCE_ARCHIVE_DIR=<tmp> npx tsx ../scripts/audit/repro/f001-empty-archive.ts
 *
 * Establishes, without touching product code, what the archive pipeline does when the bytes it is
 * handed are empty or absent. Three separate questions, three separate answers:
 *
 *   A. store([]) — zero artifacts. Does the receipt look like a success?
 *   B. store([artifact with 0 bytes]) — does anything object?
 *   C. a full executor run for a country whose format provider is a stub builder — does an empty
 *      document really traverse build → validate → sign → archive untouched?
 *
 * Read-only with respect to the repo: it writes only under COMPLIANCE_ARCHIVE_DIR.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { defaultArchiveRegistry } from '../../../backend/src/compliance/providers/archive/registry';
import type { ArchivalPolicy } from '../../../backend/src/compliance/profiles/schema';
import { RecordingComplianceLogger } from '../../../backend/src/compliance/execution/logger';
import type { SignedArtifact } from '../../../backend/src/compliance/execution/types';
import type {
  PartyTaxProfile,
  TransactionContext,
} from '../../../backend/src/compliance/canonical/canonical-document';
import { resolve as resolvePlan } from '../../../backend/src/compliance/engine/compliance-engine';
import { ComplianceExecutor } from '../../../backend/src/compliance/execution/executor';
import { NumberingRegistry } from '../../../backend/src/compliance/lifecycle/numbering';
import type { PartyRole, SupplyType } from '../../../backend/src/compliance/types';

const ROOT = process.env.COMPLIANCE_ARCHIVE_DIR;
if (!ROOT) {
  process.stderr.write('refusing to run without COMPLIANCE_ARCHIVE_DIR — it would write into the repo\n');
  process.exit(1);
}

const line = (s = '') => process.stdout.write(`${s}\n`);
const policy = (residency?: string): ArchivalPolicy => ({
  retentionYears: 10,
  residency,
  archivedForm: 'AUTHORITATIVE_XML',
  integrity: 'SIGNED',
});

const SHA256_OF_NOTHING = createHash('sha256').digest('hex');

function tree(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tree(p));
    else out.push(`${path.relative(ROOT!, p)} (${fs.statSync(p).size} octets)`);
  }
  return out;
}

// ── A. an empty artifact list ───────────────────────────────────────────────
line('== A. defaultArchiveRegistry.store([], policy) — zéro artefact ==');
const logA = new RecordingComplianceLogger();
const receiptA = defaultArchiveRegistry.store([], policy('EU'), logA);
line(`receipt        : ${JSON.stringify(receiptA)}`);
line(`SHA-256("")    : ${SHA256_OF_NOTHING}`);
line(`contentHash == SHA-256 de la chaîne vide ? ${receiptA.contentHash === SHA256_OF_NOTHING}`);
line(`répertoire créé, contenu : ${JSON.stringify(tree(path.join(ROOT, 'EU')))}`);
line(`le receipt signale-t-il l'absence de contenu ? ${'artifactCount' in receiptA ? 'oui' : 'NON'}`);
line();

// ── B. one artifact carrying zero bytes ─────────────────────────────────────
line('== B. store([artefact de 0 octet]) ==');
const emptyArtifact: SignedArtifact = {
  role: 'AUTHORITATIVE',
  syntax: 'NFE',
  mime: 'application/xml',
  bytes: new Uint8Array(),
};
const logB = new RecordingComplianceLogger();
const receiptB = defaultArchiveRegistry.store([emptyArtifact], policy('BR'), logB);
line(`receipt        : ${JSON.stringify(receiptB)}`);
line(`fichiers écrits: ${JSON.stringify(tree(path.join(ROOT, 'BR')))}`);
line(`un avertissement a-t-il été émis ? ${JSON.stringify(logB.entries.map((e) => `${e.level}:${e.scope}`))}`);
line();

// ── C. the full pipeline, for a country served by a stub format provider ────
function party(country: string, role: PartyRole): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: role === 'B2B' ? [{ scheme: 'VAT', value: `${country}1`, validated: true }] : [],
  };
}
function tx(supplier: string, buyer: string, date: string): TransactionContext {
  return {
    supplier: party(supplier, 'B2B'),
    buyer: party(buyer, 'B2B'),
    lines: [
      { id: 'l1', description: 'audit', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' as SupplyType },
    ],
    issueDate: new Date(date),
    currency: 'BRL',
  };
}

line('== C. pipeline complet, Brésil (syntaxe NFE → builder stub) ==');
const ctx = tx('BR', 'BR', '2026-06-01');
const plan = resolvePlan(ctx);
line(`plan.artifacts : ${JSON.stringify(plan.artifacts.map((a) => `${a.role}/${a.syntax}`))}`);
const logC = new RecordingComplianceLogger();
const executor = new ComplianceExecutor({ numbering: new NumberingRegistry(), logger: logC });

executor
  .execute(ctx, plan)
  .then((result) => {
    line(`artefacts construits : ${result.artifacts.length}`);
    for (const a of result.artifacts) {
      line(
        `  ${a.role}/${a.syntax}: ${a.bytes.length} octets — validation.valid=${a.validation?.valid} ` +
          `errors=${a.validation?.errors?.length ?? 0} warnings=${JSON.stringify(a.validation?.warnings ?? [])}`,
      );
    }
    const totalBytes = result.artifacts.reduce((n, a) => n + a.bytes.length, 0);
    line(`octets réellement produits par tout le pipeline : ${totalBytes}`);
    line(`le pipeline a-t-il bloqué (FormatValidationError) ? NON — il est arrivé jusqu'au bout`);
    line(`transmissions : ${JSON.stringify(result.transmissions.map((t) => `${t.channel}:${t.status}`))}`);
    line(`archive       : ${JSON.stringify(result.archive)}`);
    line(`warnings      : ${JSON.stringify(result.warnings)}`);
    line(`fichiers archivés : ${JSON.stringify(tree(ROOT))}`);
  })
  .catch((e: unknown) => {
    line(`le pipeline A BLOQUÉ : ${e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)}`);
  });
