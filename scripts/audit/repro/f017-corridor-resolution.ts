/**
 * REPRODUCTION — F-017 (audit/compliance-truth)
 *
 * Question: is the compliance plan resolved from a COUNTRY, or from the corridor
 * (supplier country, buyer country, nature of the supply)?
 *
 * Three layers stack, and they do not share an attachment rule:
 *   1. VAT invoicing rules      — Art. 219 bis of Directive 2006/112/EC: the Member State where
 *                                 the supply is deemed to take place, with derogations.
 *   2. National clearance       — national law, triggered on establishment/registration.
 *   3. Receiver obligations     — reception and archival in the BUYER's country.
 *
 * This probes what `engine/compliance-engine.resolve()` actually produces, layer by layer, and
 * which profile each layer came from. Pure read: it calls resolve() only, never the executor, and
 * writes nothing.
 *
 * Run: cd backend && npx tsx ../scripts/audit/repro/f017-corridor-resolution.ts
 */
import { resolve as resolvePlan } from '../../../backend/src/compliance/engine/compliance-engine';
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
    identifiers: role === 'B2B' ? [{ scheme: 'VAT', value: `${country}123456789`, validated: true }] : [],
  };
}

function tx(supplier: string, buyer: string, role: PartyRole = 'B2B'): TransactionContext {
  return {
    supplier: party(supplier),
    buyer: party(buyer, role),
    lines: [{ id: 'l1', description: 'audit', quantity: 1, unitNetMinor: 100000, supplyType: 'SERVICES' as SupplyType }],
    issueDate: new Date('2026-10-01'),
    currency: 'EUR',
  };
}

function report(label: string, ctx: TransactionContext) {
  const p = resolvePlan(ctx);
  line(`── ${label}`);
  line(`   supplier=${ctx.supplier.countryCode}  buyer=${ctx.buyer.countryCode}  crossBorder=${p.classification.crossBorder}`);
  line(`   régime        : ${p.regime.model} (bloquant=${p.regime.blocking})`);
  line(`   canaux        : ${p.channels.map((c) => `${c.type}${c.providerId ? `:${c.providerId}` : ''}`).join(', ')}`);
  line(`   artefacts     : ${p.artifacts.map((a) => `${a.role}/${a.syntax}`).join(', ')}`);
  line(`   cycle de vie  : immutableAfter=${p.lifecycle.immutableAfter} correction=${p.lifecycle.correctionModel}`);
  line(`   archivage     : ${p.archival.retentionYears}y ${p.archival.archivedForm} ${p.archival.integrity}${p.archival.residency ? ` residency=${p.archival.residency}` : ''}`);
  line(`   numérotation  : ${p.numbering.model}`);
  line(`   reporting     : ${p.reporting.join(', ') || '—'}`);
  line(`   TVA           : ${p.tax.lines?.[0]?.taxes?.map((t: { rate: number; category: string }) => `${t.rate}% ${t.category}`).join(' + ') ?? JSON.stringify(p.tax).slice(0, 120)}`);
  line(`   confiance     : ${p.confidence}`);
  if (p.warnings.length) line(`   avertissements: ${JSON.stringify(p.warnings)}`);
  line();
  return p;
}

line('=== A. Le corridor change-t-il le plan ? ===');
line('Même fournisseur français, trois destinations.');
line();
const frFr = report('FR → FR (domestique)', tx('FR', 'FR'));
const frIt = report('FR → IT (intracommunautaire B2B)', tx('FR', 'IT'));
const frUs = report('FR → US (export hors UE)', tx('FR', 'US'));

line('=== B. Quelles couches ont réellement bougé ? ===');
const layers: Array<[string, (p: ReturnType<typeof resolvePlan>) => string]> = [
  ['régime', (p) => `${p.regime.model}/${p.regime.blocking}`],
  ['canaux', (p) => p.channels.map((c) => `${c.type}${c.providerId ? `:${c.providerId}` : ''}`).join(',')],
  ['artefacts', (p) => p.artifacts.map((a) => `${a.role}/${a.syntax}`).join(',')],
  ['cycle de vie', (p) => `${p.lifecycle.immutableAfter}/${p.lifecycle.correctionModel}`],
  ['archivage', (p) => `${p.archival.retentionYears}y/${p.archival.archivedForm}/${p.archival.integrity}`],
  ['numérotation', (p) => p.numbering.model],
  ['reporting', (p) => p.reporting.join(',') || '—'],
];
line('| couche | FR→FR | FR→IT | FR→US | varie ? |');
line('| --- | --- | --- | --- | --- |');
for (const [name, get] of layers) {
  const a = get(frFr);
  const b = get(frIt);
  const c = get(frUs);
  const varies = new Set([a, b, c]).size > 1;
  line(`| ${name} | ${a} | ${b} | ${c} | ${varies ? '**OUI**' : 'non'} |`);
}
line();

line('=== C. Les obligations du récepteur apparaissent-elles ? ===');
line("Pour FR → IT, l'acheteur italien a ses propres obligations de réception et d'archivage.");
line('Le plan porte-t-il quoi que ce soit du profil acheteur, hors fiscalité ?');
line(`   plan.buyer            : ${JSON.stringify(frIt.buyer)}`);
line(`   archivage du plan     : ${frIt.archival.retentionYears}y — celui du FOURNISSEUR (FR)`);
line(`   un champ « archivage acheteur » existe-t-il ? ${'buyerArchival' in frIt ? 'oui' : 'NON'}`);
line(`   un champ « obligations acheteur » existe-t-il ? ${'buyerObligations' in frIt ? 'oui' : 'NON'}`);
line();

line("=== D. Le cas décisif : société française immatriculée à la TVA en Italie, vente IT → IT ===");
line("Le droit italien vise l'opération domestique italienne : SdI, clearance bloquante, FatturaPA.");
line('Que peut exprimer le modèle ?');
line();
line("Ce que l'application construit (invoices.helpers.ts : countryCode = celui de la société) :");
const asBuilt = report('supplier.countryCode=FR, buyer.countryCode=IT', tx('FR', 'IT'));
line('Ce que la règle italienne exigerait :');
const asLaw = report('supplier.countryCode=IT, buyer.countryCode=IT', tx('IT', 'IT'));

line('Comparaison :');
line(`   régime   — construit: ${asBuilt.regime.model}/${asBuilt.regime.blocking}   |  requis: ${asLaw.regime.model}/${asLaw.regime.blocking}`);
line(`   canaux   — construit: ${asBuilt.channels.map((c) => c.type).join(',')}   |  requis: ${asLaw.channels.map((c) => c.type).join(',')}`);
line(`   artefact — construit: ${asBuilt.artifacts[0].syntax}   |  requis: ${asLaw.artifacts[0].syntax}`);
line();
line("Le modèle peut-il exprimer « établi en FR, immatriculé en IT » ?");
line('   PartyTaxProfile.establishmentCountry existe dans le type.');
line('   Occurrences dans tout le dépôt hors sa déclaration : voir le grep du rapport — AUCUNE.');
line('   Il n’est ni peuplé par invoices.helpers.ts, ni lu par compliance-engine.ts.');
line();
line('=== E. Ce qui alimente countryCode en production ===');
line('   invoices.helpers.ts : company.countryCode ?? guessCountryCode(company.country) ?? "FR"');
line('   → c’est le pays de la SOCIÉTÉ, jamais un pays d’immatriculation lié à l’opération,');
line('     et un pays non résolu retombe silencieusement sur la France.');
