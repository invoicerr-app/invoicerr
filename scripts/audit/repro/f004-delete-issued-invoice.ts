/**
 * REPRODUCTION — F-004 / F-005 / F-006 (audit/compliance-truth, phase 1 point 2)
 *
 * Question: can a document that has been issued, numbered and transmitted be DELETED, and is the
 * protection in the database or only in application code?
 *
 * Method: everything runs inside one Prisma interactive transaction that ends with a deliberate
 * throw, so the transaction ROLLS BACK. Nothing is persisted. The script never touches production:
 * it reads DATABASE_URL, which points at the local test database.
 *
 * Run: cd backend && npx dotenv -e .env.test -- npx tsx ../scripts/audit/repro/f004-delete-issued-invoice.ts
 */
import prisma from '../../../backend/src/prisma/prisma.service';

const line = (s = '') => process.stdout.write(`${s}\n`);
const ROLLBACK = 'AUDIT_ROLLBACK_SENTINEL';

/**
 * Runs `body` inside a transaction that is always rolled back. One transaction per step, because a
 * foreign-key violation aborts the entire Postgres transaction block ("current transaction is
 * aborted, commands ignored until end of transaction block") — step 2 deliberately provokes one,
 * so steps 3 and 4 must not share its transaction.
 */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
async function inRolledBackTx(body: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await body(tx);
        throw new Error(ROLLBACK);
      },
      { timeout: 60_000 },
    );
  } catch (e) {
    if (!(e instanceof Error && e.message === ROLLBACK)) {
      line(`   [transaction interrompue] ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  }
}

/** Recreates the whole fixture inside the given transaction. Returns the ids the steps need. */
async function fixture(tx: Tx) {
  const pdfConfig = await tx.pDFConfig.create({ data: {} });
  const company = await tx.company.create({
    data: {
      name: 'AUDIT SARL',
      foundedAt: new Date('2020-01-01'),
      address: '1 rue de l Audit',
      postalCode: '75001',
      city: 'Paris',
      country: 'FR',
      phone: '+33100000000',
      email: 'audit@example.invalid',
      pDFConfigId: pdfConfig.id,
    },
  });
  const client = await tx.client.create({
    data: {
      companyId: company.id,
      name: 'AUDIT Client',
      address: '2 rue du Client',
      postalCode: '75002',
      city: 'Paris',
      country: 'FR',
    },
  });
  const invoice = await tx.invoice.create({
    data: {
      clientId: client.id,
      companyId: company.id,
      dueDate: new Date('2026-09-30'),
      totalHT: 100,
      totalVAT: 20,
      totalTTC: 120,
      currency: 'EUR',
      // The state that matters: issued, numbered, no longer a draft.
      status: 'SENT',
      number: 42,
      rawNumber: 'FA-2026-0042',
      issuedAt: new Date('2026-08-01'),
    },
  });
  const doc = await tx.complianceDocument.create({
    data: {
      id: `audit-doc-${invoice.id}`,
      invoiceId: invoice.id,
      status: 'CLEARED',
      number: 'FA-2026-0042',
      immutableHash: 'deadbeef',
      ctx: {},
    },
  });
  await tx.complianceEvent.create({
    data: { documentId: doc.id, type: 'CLEAR', actor: 'authority', detail: 'audit fixture' },
  });
  await tx.complianceAuthorityId.create({
    data: { documentId: doc.id, scheme: 'KSEF', value: 'KSEF-FIXTURE-1' },
  });
  return { company, client, invoice, doc };
}

async function main() {
  line(`base cible : ${(process.env.DATABASE_URL ?? '(non définie)').replace(/:[^:@]*@/, ':***@')}`);
  line('fixture (recréée à chaque étape) : facture SENT n° FA-2026-0042 + document conformité CLEARED');
  line('                                   + 1 événement CLEAR + 1 identifiant autorité');
  line();

  // ── 1. hard delete of an issued, cleared, numbered invoice ─────────────────────────
  line('== 1. prisma.invoice.deleteMany({ where: { companyId } }) sur une facture SENT/CLEARED ==');
  line('   (c’est littéralement danger.service.ts:64, sans aucun filtre de statut)');
  await inRolledBackTx(async (tx) => {
    const { company, doc } = await fixture(tx);
    try {
      const res = await tx.invoice.deleteMany({ where: { companyId: company.id } });
      line(`   RÉSULTAT : ${res.count} facture(s) supprimée(s) définitivement — aucune erreur`);
      line(`   factures restantes : ${await tx.invoice.count({ where: { companyId: company.id } })}`);
      const docAfter = await tx.complianceDocument.findUnique({ where: { id: doc.id } });
      line(
        `   ComplianceDocument : ${docAfter ? `conservé, invoiceId = ${JSON.stringify(docAfter.invoiceId)}` : 'SUPPRIMÉ EN CASCADE'}`,
      );
      line(
        `   événements conservés : ${await tx.complianceEvent.count({ where: { documentId: doc.id } })}` +
          ` — identifiants autorité conservés : ${await tx.complianceAuthorityId.count({ where: { documentId: doc.id } })}`,
      );
    } catch (e) {
      line(`   BLOQUÉ : ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  });
  line();

  // ── 2. deleting the company — the first statement resetApp() actually runs ─────────
  line('== 2. prisma.company.deleteMany({ where: { id } }) — 1re instruction de resetApp() ==');
  await inRolledBackTx(async (tx) => {
    const { company } = await fixture(tx);
    try {
      const res = await tx.company.deleteMany({ where: { id: company.id } });
      line(`   RÉSULTAT : ${res.count} société supprimée — aucune contrainte n'a bloqué`);
    } catch (e) {
      // Prisma prefixes the message with the whole invocation + source excerpt; keep the cause.
      const raw = e instanceof Error ? e.message.replace(/\s+/g, ' ') : String(e);
      const cause = raw.match(/(Foreign key constraint violated[^]*?)(?: at |$)/)?.[1] ?? raw.slice(-160);
      line(`   BLOQUÉ par la base : ${cause.trim()}`);
    }
  });
  line();

  // ── 3. is the compliance event log append-only at the DB level? ────────────────────
  line('== 3. le journal ComplianceEvent est-il append-only en base ? ==');
  await inRolledBackTx(async (tx) => {
    const { doc } = await fixture(tx);
    const ev = (await tx.complianceEvent.findFirst({ where: { documentId: doc.id } }))!;
    try {
      const upd = await tx.complianceEvent.update({ where: { id: ev.id }, data: { type: 'FALSIFIE' } });
      line(`   UPDATE d'un événement : ACCEPTÉ (type "${ev.type}" → "${upd.type}")`);
    } catch (e) {
      line(`   UPDATE refusé : ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  });
  await inRolledBackTx(async (tx) => {
    const { doc } = await fixture(tx);
    const ev = (await tx.complianceEvent.findFirst({ where: { documentId: doc.id } }))!;
    try {
      await tx.complianceEvent.delete({ where: { id: ev.id } });
      line(`   DELETE d'un événement : ACCEPTÉ — reste ${await tx.complianceEvent.count({ where: { documentId: doc.id } })} événement(s)`);
    } catch (e) {
      line(`   DELETE refusé : ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  });
  line();

  // ── 4. can an already-cleared compliance document be rewritten? ────────────────────
  line('== 4. un ComplianceDocument CLEARED peut-il être réécrit ? ==');
  await inRolledBackTx(async (tx) => {
    const { doc } = await fixture(tx);
    try {
      const upd = await tx.complianceDocument.update({
        where: { id: doc.id },
        data: { number: 'FA-2026-9999', immutableHash: 'cafebabe', status: 'DRAFT' },
      });
      line(`   UPDATE ACCEPTÉ : number "${doc.number}" → "${upd.number}",`);
      line(`                    immutableHash "${doc.immutableHash}" → "${upd.immutableHash}",`);
      line(`                    status "${doc.status}" → "${upd.status}"`);
    } catch (e) {
      line(`   UPDATE refusé : ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  });
  line();

  // ── 5. does a DB-level guard exist at all? ─────────────────────────────────────────
  line('== 5. existe-t-il une garde en base (trigger / règle / contrainte) ? ==');
  const triggers = await prisma.$queryRawUnsafe<Array<{ table: string; trigger: string }>>(
    `SELECT event_object_table AS table, trigger_name AS trigger
       FROM information_schema.triggers
      WHERE trigger_schema = 'public'`,
  );
  const userTriggers = triggers.filter((t) => !t.trigger.startsWith('RI_ConstraintTrigger'));
  line(`   triggers applicatifs sur le schéma public : ${userTriggers.length}`);
  for (const t of userTriggers.slice(0, 20)) line(`     ${t.table}.${t.trigger}`);
  const checks = await prisma.$queryRawUnsafe<Array<{ table: string; constraint: string; def: string }>>(
    `SELECT rel.relname AS table, con.conname AS constraint, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE con.contype = 'c' AND ns.nspname = 'public'
        AND rel.relname IN ('Invoice','ComplianceDocument','ComplianceEvent','NumberSeries')`,
  );
  line(`   contraintes CHECK sur Invoice/ComplianceDocument/ComplianceEvent/NumberSeries : ${checks.length}`);
  for (const c of checks) line(`     ${c.table}.${c.constraint} = ${c.def}`);

  line();
  line('— toutes les transactions ont été annulées : la base de test est inchangée —');
  await prisma.$disconnect();
}

void main();
