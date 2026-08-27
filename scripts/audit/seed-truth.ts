/**
 * Seeds docs/compliance/audit/compliance-truth.json from the phase-0 inventory + phase-1 findings.
 *
 * Run: cd backend && npx tsx ../scripts/audit/seed-truth.ts   (after inventory.ts)
 *
 * SCOPE — read this before trusting a level in the output.
 * No primary source has been consulted yet (that is phase 2), and no sandbox has been probed
 * (phase 3). This seed can therefore only ever assign:
 *
 *   L0  nothing implemented for that capability
 *   L2  the code visibly implements it and the file can be pointed at
 *
 * It CANNOT assign L1 (a sourced legal rule — needs a URL and a date), L3 (a test against an
 * authority artifact — needs the artifact to be identified as authoritative, per capability),
 * or L4/L5 (a live run — the repo holds no dated, versioned proof of one; see F-013).
 *
 * The one exception is `format_generation`, where the authority artifact is vendored IN the repo
 * (schemas/{mx,it,pl,es}/*.xsd, schemas/en16931 + peppol + de *.sch) and is demonstrably executed
 * by the provider. That is L3 by the definition in use, and it is marked as such.
 *
 * Every field this seed cannot honestly fill is `null` with an `open_question`, never a plausible
 * guess.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO, 'docs', 'compliance', 'audit');
const inventory = JSON.parse(fs.readFileSync(path.join(AUDIT, 'inventory.json'), 'utf8'));

const AUDITED_AT = '2026-08-27';

/** Syntaxes whose provider runs a vendored AUTHORITY artifact (XSD or the official Schematron). */
const L3_SYNTAXES: Record<string, string> = {
  CFDI: 'backend/src/compliance/schemas/mx/cfdv40.xsd (SAT) — providers.ts:349',
  FATTURAPA: 'backend/src/compliance/schemas/it/Schema_VFPR12.xsd (AdE) — providers.ts:395',
  FA_VAT: 'backend/src/compliance/schemas/pl/schemat_FA3.xsd (MF) — providers.ts:524',
  ES_FACTURAE: 'backend/src/compliance/schemas/es/Facturaev3_2_2.xsd — providers.ts:568',
  PEPPOL_BIS: 'backend/src/compliance/schemas/peppol/PEPPOL-EN16931-UBL.sch — providers.ts:178',
  EN16931_UBL: 'backend/src/compliance/schemas/en16931/EN16931-UBL-validation-preprocessed.sch — providers.ts:189',
  EN16931_CII: 'backend/src/compliance/schemas/en16931/EN16931-CII-validation-preprocessed.sch — providers.ts:171',
  FACTURX: 'backend/src/compliance/schemas/en16931/EN16931-CII-validation-preprocessed.sch — providers.ts:171',
  XRECHNUNG: 'backend/src/compliance/schemas/de/XRechnung-UBL-validation-preprocessed.sch (KoSIT) — providers.ts:235',
};

/** Real builders with no authority artifact behind them. */
const L2_SYNTAXES = new Set(['PLAIN_PDF', 'KSA_UBL', 'NATIONAL_XML', 'ZUGFERD', 'PDF_A3']);

/** Inbound parsers that exist (lifecycle/drivers/inbound-parsers.ts + reception/). */
const RECEPTION_BY_CHANNEL: Record<string, string> = {
  PDP: 'backend/src/compliance/lifecycle/drivers/inbound-parsers.ts:55 parsePdpWebhook',
  SDI: 'backend/src/compliance/lifecycle/drivers/inbound-parsers.ts:105 parseSdiNotifica',
  PEPPOL: 'backend/src/compliance/lifecycle/drivers/inbound-parsers.ts:179 parsePeppolMlr',
};
const KSEF_RECEPTION = 'backend/src/compliance/reception/ksef-purchase-reception.spec.ts + ksef-inbox-port.ts';


/**
 * Phase-3 testability, per country, for the nine channels actually researched (04-TESTABILITY.md).
 * Every entry is backed by a primary source consulted on 2026-08-27. Countries absent from this map
 * keep `null` + an open_question: their testability was deliberately NOT researched (scoping out the
 * 41 stub portals), and "not researched" must never be rendered as "no sandbox".
 */
const TESTABILITY: Record<
  string,
  {
    sandbox: boolean;
    access: 'open' | 'gated' | 'none';
    prerequisites: string;
    ceiling: string;
    source: string;
  }
> = {
  PL: {
    sandbox: true,
    access: 'open',
    prerequisites:
      "Aucune. L'environnement d'intégration api-test.ksef.mf.gov.pl s'utilise avec des données anonymisées ; ni inscription, ni contrat, ni approbation ministérielle documentés. La préproduction (Demo) exige en revanche des identifiants réels.",
    ceiling: 'L4',
    source: 'https://ksef.podatki.gov.pl/ksef-na-okres-obligatoryjny/wsparcie-dla-integratorow/',
  },
  FR: {
    sandbox: true,
    access: 'gated',
    prerequisites:
      "L'environnement de qualification AIFE (ouvert le 2025-10-14) est réservé aux plateformes agréées ; aucun chemin d'accès pour un éditeur non immatriculé n'est documenté. Chorus Pro fait exception : son portail de qualification est librement accessible via un compte PISTE, qui provisionne automatiquement une application SANDBOX.",
    ceiling: 'L4 pour Chorus Pro ; L2 pour le PPF sans immatriculation',
    source:
      'https://www.impots.gouv.fr/actualite/immatriculation-des-plateformes-agreees-levee-des-reserves-ouverture-de-lenvironnement-de',
  },
  DE: {
    sandbox: true,
    access: 'open',
    prerequisites:
      "Inscription libre et gratuite sur OZG-RE (unique plateforme fédérale depuis l'arrêt de ZRE le 2025-12-31), environnement de test disponible, et web service Peppol fédéral gratuit sur simple demande. Couvre le B2G ; le régime B2B n'a pas été cartographié ici.",
    ceiling: 'L4 pour le B2G',
    source: 'https://e-rechnung-bund.de/en/faq/how-can-i-send-test-invoices-via-peppol-to-the-ozg-re-portal/',
  },
  IT: {
    sandbox: true,
    access: 'gated',
    prerequisites:
      "Accréditation préalable obligatoire via accreditamento.fatturapa.gov.it (accord de service, puis tests d'interopérabilité, puis passage en production). Limite journalière de transmission en test. Les conditions d'éligibilité à l'accréditation ne sont pas documentées publiquement.",
    ceiling: 'L2 sans accréditation',
    source: 'https://www.fatturapa.gov.it/it/sistemainterscambio/sperimentazione/',
  },
  ES: {
    sandbox: true,
    access: 'none',
    prerequisites:
      "Un portail de tests externes existe (https://preportal.aeat.es) mais la page d'information technique de l'AEAT ne documente ni ses prérequis d'accès ni ses capacités. Accès non établi.",
    ceiling: 'non déterminé',
    source:
      'https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica.html',
  },
  MX: {
    sandbox: false,
    access: 'gated',
    prerequisites:
      "Aucun timbrado direct auprès du SAT : le passage par un PAC (acteur privé autorisé) est structurel. Le SAT délivre des CSD de test. L'existence d'un sandbox dépend de chaque PAC, pas de l'autorité.",
    ceiling: 'L2 sans contrat PAC',
    source: 'https://www.sat.gob.mx/consulta/76969/proveedores-autorizados-de-certificacion-(pac%C2%B4s)-',
  },
};

/**
 * Feasibility verdicts that phase 3 established firmly enough to record now. Everything else stays
 * null: phase 4 has not run, and a plausible verdict is worse than an absent one.
 */
const FEASIBILITY: Record<
  string,
  { self_hosted_anonymous: string; with_publisher_entity: string; certification_required: string; rationale: string; source: string }
> = {
  FR: {
    self_hosted_anonymous: 'only_with_provider',
    with_publisher_entity: 'requires_certification',
    certification_required:
      "Immatriculation comme plateforme agréée auprès du Service d'Immatriculation de la DGFiP (dossier sur demarche.numerique.gouv.fr), validité 3 ans renouvelable.",
    rationale:
      "« Seule une plateforme agréée est habilitée à assurer toutes les fonctionnalités prévues » : une instance self-hosted ne peut pas transmettre par elle-même. Se raccorder à une plateforme agréée tierce — ce que fait le provider `pdp` — est le seul chemin sans immatriculation. Obligation en vigueur au 2026-09-01.",
    source: 'https://www.impots.gouv.fr/facturation-electronique-et-plateformes-agreees',
  },
  MX: {
    self_hosted_anonymous: 'only_with_provider',
    with_publisher_entity: 'requires_certification',
    certification_required:
      "Autorisation SAT pour opérer comme Proveedor Autorizado de Certificación, selon l'Anexo 1-A de la RMF en vigueur (implique notamment d'être à jour de ses obligations fiscales mexicaines).",
    rationale:
      'Le timbrado ne peut pas être effectué directement : il passe obligatoirement par un PAC, acteur privé autorisé par le SAT, qui valide, timbre et transmet copie à l\'autorité.',
    source: 'https://www.sat.gob.mx/tramites/31454/solicita-autorizacion-para-operar-como-proveedor-de-certificacion',
  },
};

type Country = (typeof inventory.countries)[number];

function cap(level: string, evidence: string[] = [], gaps: string[] = []) {
  return { level, evidence, gaps };
}

function formatCapability(c: Country) {
  if (!c.profile.present || c.formats.length === 0) {
    return cap('L0', [], ['aucune syntaxe déclarée par le profil']);
  }
  const evidence: string[] = [];
  const gaps: string[] = [];
  let best = 'L0';
  // Only the AUTHORITATIVE artifact counts. A country whose legally-required syntax is a stub does
  // not earn a level because its human-readable PDF companion happens to be real.
  const primaries = c.formats.filter((f: { primary: boolean }) => f.primary);
  for (const f of primaries.length > 0 ? primaries : c.formats) {
    if (f.stubByConstruction || f.providerId === null) {
      gaps.push(
        `${f.syntax} : builder stub à octets vides (national-formats.ts) — voir F-001`,
      );
      continue;
    }
    if (L3_SYNTAXES[f.syntax]) {
      evidence.push(L3_SYNTAXES[f.syntax]);
      best = 'L3';
    } else if (L2_SYNTAXES.has(f.syntax)) {
      evidence.push(`${f.syntax} → provider ${f.providerId} (aucun artefact d'autorité)`);
      if (best === 'L0') best = 'L2';
    }
  }
  // The empty-document hole applies to every syntax without exception (phase-0 probe: 54/54).
  gaps.push('`validate()` déclare valide un document de zéro octet — F-001');
  return cap(best, evidence, gaps);
}

/** Channels that can reach an authority / CTC network. E-mail and print reach the buyer only. */
const AUTHORITY_CHANNELS = new Set(['GOV_PORTAL_API', 'SDI', 'PDP', 'PEPPOL']);
const AUTHORITY_REGIMES = ['CLEARANCE', 'REAL_TIME_REPORTING', 'DECENTRALIZED_CTC'];

function transmissionCapability(c: Country) {
  const gapsForEmailOnly: string[] = [];
  const providers = c.providers.filter((p: { registered: boolean }) => p.registered);
  if (providers.length === 0) {
    return cap('L0', [], ['aucun provider ne résout pour les canaux déclarés']);
  }
  let wired = providers.filter((p: { noDefaultTransport: boolean }) => !p.noDefaultTransport);
  // When the profile itself declares a regime that requires an authority channel, a wired e-mail
  // provider does not satisfy the capability — it reaches the buyer, never the authority.
  const needsAuthority =
    c.profile.present && c.profile.regimeModels.some((m: string) => AUTHORITY_REGIMES.includes(m));
  if (needsAuthority) {
    const authorityWired = wired.filter((p: { channelType: string }) => AUTHORITY_CHANNELS.has(p.channelType));
    if (authorityWired.length === 0 && wired.length > 0) {
      wired = [];
      gapsForEmailOnly.push(
        `le profil déclare ${c.profile.regimeModels.join('/')} mais le seul transport joignable est ${providers
          .filter((p: { noDefaultTransport: boolean }) => !p.noDefaultTransport)
          .map((p: { id: string }) => p.id)
          .join(', ')} — F-004 catégorie 1b`,
      );
    } else {
      wired = authorityWired;
    }
  }
  const evidence: string[] = [];
  const gaps: string[] = [];
  for (const p of providers) {
    const inv = inventory.transmissionProviders.find((x: { id: string }) => x.id === p.id);
    const where = inv?.source?.declaredIn?.[0] ?? '(source non localisée)';
    if (p.noDefaultTransport) {
      gaps.push(
        `${p.id} (${p.maturity}) : aucun transport câblé — le registre n'injecte jamais de port HTTP (registry.ts:70-88). Voir F-009.`,
      );
    } else {
      evidence.push(`${p.id} (${p.maturity}) — ${where}, ${inv?.source?.httpCallSites ?? 0} site(s) d'appel réseau`);
    }
  }
  gaps.push(...gapsForEmailOnly);
  gaps.push(
    "aucun artefact daté d'exécution live dans le dépôt : L4/L5 non vérifiable en l'état — F-013",
  );
  return cap(wired.length > 0 ? 'L2' : 'L0', evidence, gaps);
}

function lifecycleCapability(c: Country) {
  if (!c.profile.present) return cap('L0', [], ['aucun profil']);
  const gaps: string[] = [];
  const evidence: string[] = [];
  if (c.profile.confidence === 'OFFICIAL') {
    evidence.push(`profil bespoke, confidence OFFICIAL — backend/src/compliance/profiles/data/`);
  } else {
    gaps.push(
      `profil construit par archétype, confidence ${c.profile.confidence} — les fenêtres et modèles de correction n'ont été vérifiés contre aucune source`,
    );
  }
  if (c.profile.regimeModels.includes('CLEARANCE')) {
    gaps.push('après rejet de l’autorité l’état REJECTED est terminal : ni re-soumission ni correction — F-007');
  }
  gaps.push('un rejet d’autorité n’est jamais reporté sur Invoice.status — F-008');
  return cap(c.profile.confidence === 'OFFICIAL' ? 'L2' : 'L0', evidence, gaps);
}

function receptionCapability(c: Country) {
  if (!c.profile.present) return cap('L0');
  const evidence: string[] = [];
  for (const p of c.providers) {
    const parser = RECEPTION_BY_CHANNEL[p.channelType];
    if (parser && !evidence.includes(parser)) evidence.push(parser);
    if (p.id === 'ksef' && !evidence.includes(KSEF_RECEPTION)) evidence.push(KSEF_RECEPTION);
  }
  if (evidence.length === 0) {
    return cap('L0', [], ['aucun parseur entrant pour les canaux de ce pays']);
  }
  return cap('L2', evidence, ['aucun test contre un accusé réel d’autorité — F-013']);
}

function archivalCapability(c: Country) {
  const gaps = [
    'le reçu d’archivage n’est persisté dans aucune table et n’est jamais vérifié — F-010',
    'aucun stockage du document réellement émis : le PDF est reconstruit à l’affichage — F-006',
  ];
  if (c.formats.some((f: { stubByConstruction: boolean }) => f.stubByConstruction)) {
    gaps.unshift('les artefacts archivés pour ce pays font zéro octet — F-001');
  }
  return cap('L2', ['backend/src/compliance/providers/archive/storage.ts persistArtifacts()'], gaps);
}

function reportingCapability(c: Country) {
  const kinds = c.profile.present ? c.profile.reportingKinds : [];
  if (kinds.length === 0) return cap('L0', [], ['aucune obligation déclarative dans le profil']);
  return cap('L0', [], [
    `obligations déclarées (${kinds.join(', ')}) mais les 10 handlers sont mockés : handleReport journalise [MOCK] et renvoie EMITTED sans rien soumettre — F-016`,
  ]);
}

const entries = inventory.countries.map((c: Country) => {
  // Monaco→FR and San Marino→IT carry a delegate stub profile with no rules of their own. Scoring
  // that stub as if it were the country's implementation would report a false L0; the real answer
  // is "see the target jurisdiction", which this seed records rather than guesses.
  const delegatesTo = c.profile.present ? c.profile.delegatesTo : null;

  const capabilities = {
    format_generation: formatCapability(c),
    lifecycle_rules: lifecycleCapability(c),
    transmission: transmissionCapability(c),
    reception: receptionCapability(c),
    archival: archivalCapability(c),
    reporting: reportingCapability(c),
  };

  const hasTransport = capabilities.transmission.level !== 'L0';
  const hasRealFormat = capabilities.format_generation.level === 'L3';

  // What the site says today, stated factually rather than interpreted.
  const publicClaimCurrent = c.doc
    ? `page publique /compliance/${c.code.toLowerCase()} publiée dans le navigateur « Compliance » à facettes` +
      `${c.doc.status ? `, status: ${c.doc.status}` : ''}${c.doc.progress ? `, progress: ${c.doc.progress}` : ''}`
    : 'aucune page publique';

  // What the evidence supports, and nothing more.
  let publicClaimJustified: string;
  if (hasRealFormat && hasTransport) {
    publicClaimJustified =
      'génération de format validée contre un schéma d’autorité vendorisé, et un canal de transmission câblé — aucune preuve d’acquittement réel par l’autorité';
  } else if (hasTransport) {
    publicClaimJustified =
      'un canal de transmission câblé, sans validation de format contre un artefact d’autorité';
  } else if (hasRealFormat) {
    publicClaimJustified =
      'génération de format validée contre un schéma d’autorité vendorisé ; aucune transmission possible';
  } else {
    publicClaimJustified =
      'aucune capacité démontrable : ni format validé, ni transmission câblée — la page décrit le régime du pays, pas ce que le produit sait faire';
  }

  // A public compliance page for a jurisdiction the product cannot transmit to is overstated even
  // when its format generation is solid: the page describes a mandate the product cannot satisfy.
  // Likewise when the legally-required artifact itself is a stub.
  const claimGap = delegatesTo
    ? 'undetermined'
    : c.doc && (!hasTransport || capabilities.format_generation.level === 'L0')
      ? 'overstated'
      : 'none';

  const findings = new Set<string>(['F-004', 'F-013']);
  if (c.formats.some((f: { stubByConstruction: boolean }) => f.stubByConstruction)) findings.add('F-001');
  if (capabilities.transmission.gaps.some((g) => g.includes('F-009'))) findings.add('F-009');
  if (c.profile.present && c.profile.regimeModels.includes('CLEARANCE')) findings.add('F-007');
  for (const f of ['F-002', 'F-003', 'F-005', 'F-006', 'F-008', 'F-010', 'F-016']) findings.add(f);

  return {
    country: c.code,
    audited_at: AUDITED_AT,
    ...(delegatesTo
      ? {
          delegates_to: delegatesTo,
          delegation_note: `Le profil de ${c.code} délègue à ${delegatesTo} (profiles/schema.ts:delegatesTo). Les niveaux ci-dessous portent sur le profil-relais lui-même, qui ne contient aucune règle propre — ils ne décrivent PAS la capacité réelle, qui est celle de ${delegatesTo}. À reprendre en phase 2 en résolvant la délégation.`,
        }
      : {}),
    audit_phase: 'phase-1 (inventaire mécanique + vérifications ciblées) — aucune source primaire consultée',
    capabilities,
    testability: TESTABILITY[c.code]
      ? { ...TESTABILITY[c.code], researched_at: AUDITED_AT }
      : {
          sandbox: null,
          access: null,
          prerequisites: null,
          ceiling: null,
          source: null,
          open_question:
            'Testabilité NON RECHERCHÉE : la phase 3 a été volontairement limitée aux 4 canaux PROVEN, aux portails des 6 pays de la phase 2 et à Chorus Pro. « Non recherché » ne veut pas dire « pas de sandbox ».',
        },
    feasibility: FEASIBILITY[c.code]
      ? { ...FEASIBILITY[c.code], determined_at: AUDITED_AT }
      : {
          self_hosted_anonymous: null,
          with_publisher_entity: null,
          certification_required: null,
          rationale: null,
          source: null,
          open_question:
            'Nécessite la phase 4 (exigences d’immatriculation / certification). Non déterminable depuis le dépôt.',
        },
    public_claim_current: publicClaimCurrent,
    public_claim_justified: publicClaimJustified,
    claim_gap: claimGap,
    rule_sources: [],
    open_questions: [
      'Aucune règle légale n’a été vérifiée contre une source primaire (phase 2) : fenêtre et méthode de correction, annulation, ce qui fait foi, statuts à remonter, durée et localisation d’archivage, champs obligatoires au-delà d’EN 16931.',
      'Aucun sandbox officiel n’a été identifié ni testé (phase 3).',
    ],
    findings: [...findings].sort(),
  };
});

const out = {
  $schema_note:
    'Amorce produite par scripts/audit/seed-truth.ts. Les niveaux L1, L4 et L5 sont volontairement absents : ils exigent respectivement une source primaire, un sandbox officiel et une transmission de production acquittée — aucun des trois n’a été établi à ce stade.',
  generated_at: AUDITED_AT,
  generator: 'scripts/audit/seed-truth.ts',
  levels: {
    L0: 'rien d’implémenté pour cette capacité',
    L1: 'règle légale sourcée sur un texte officiel (URL + date) — NON ATTEINT, phase 2',
    L2: 'le code implémente visiblement la règle, on peut montrer où',
    L3: 'un test vérifie le comportement contre un artefact officiel de l’autorité',
    L4: 'un test live passe contre le sandbox officiel — NON ATTEINT, phase 3',
    L5: 'une transmission de production a été acquittée — NON ATTEINT',
  },
  countries: entries,
};

fs.writeFileSync(path.join(AUDIT, 'compliance-truth.json'), `${JSON.stringify(out, null, 2)}\n`);

const byGap = entries.reduce((acc: Record<string, number>, e: { claim_gap: string }) => {
  acc[e.claim_gap] = (acc[e.claim_gap] ?? 0) + 1;
  return acc;
}, {});
const byFmt = entries.reduce((acc: Record<string, number>, e: any) => {
  const l = e.capabilities.format_generation.level;
  acc[l] = (acc[l] ?? 0) + 1;
  return acc;
}, {});
const byTx = entries.reduce((acc: Record<string, number>, e: any) => {
  const l = e.capabilities.transmission.level;
  acc[l] = (acc[l] ?? 0) + 1;
  return acc;
}, {});
process.stdout.write(
  `compliance-truth.json: ${entries.length} pays\n  claim_gap ${JSON.stringify(byGap)}\n  format ${JSON.stringify(byFmt)}\n  transmission ${JSON.stringify(byTx)}\n`,
);
