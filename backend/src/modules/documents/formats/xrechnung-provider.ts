/**
 * XRechnung 3.0.x (KoSIT) — the UBL syntax `ubl-provider.ts` already builds, judged by the SAME base
 * EN 16931 Schematron PLUS the vendored KoSIT delta
 * (`vendored/de/XRechnung-UBL-validation-preprocessed.sch`) RUNNING ON TOP OF IT — never instead of
 * it, exactly like `peppol-bis-provider.ts`'s own sibling gate.
 *
 * ## COUNTRY-NEUTRAL BY DESIGN — read this before assuming a DE seller check belongs here
 *
 * XRechnung is a FORMAT, not a residency requirement: a seller in ANY country can issue one to a
 * German public-sector buyer (the real-world case this standard exists for — a Leitweg-ID only makes
 * sense addressed to a German Behörde, but the SENDER need not be German). This provider therefore
 * never inspects `company.country` — the exact same "no business code names a country" discipline
 * `format-registry.ts` already holds for the registry itself. The DATA the delta demands (BT-10,
 * seller contact, an IBAN) is required of EVERY seller that requests this syntax, French or German
 * alike; only the DE `country-fields/` overlay (below) happens to be the one screen that offers a
 * Leitweg-ID input today — a seller from another country can still supply the exact same
 * `data.buyerReference` value some other way (see `build-semantic-invoice.ts`'s own header) and the
 * bridge does not care where it came from.
 *
 * ## What BR-DE-* actually demanded, read from the vendored .sch's own fatal `<assert>`s
 *
 *  - BR-DE-15 (fatal): `cbc:BuyerReference` (BT-10) non-empty. Comblé par le mécanisme GÉNÉRIQUE
 *    (`build-semantic-invoice.ts`'s `buyerReference`, alimenté par `data.buyerReference`) — la SEULE
 *    entrée-écran connue aujourd'hui est le champ Leitweg-ID ajouté par l'overlay pays DE
 *    (`country-fields/data/de.json`, add, path `''`, optionnel — jamais un champ générique imposé à
 *    tous les pays sur le descripteur trunc). Absent → refus nommé BR-DE-15, exactement le
 *    comportement attendu du gate.
 *  - BR-DE-2/5/6/7 (fatal): SELLER CONTACT (nom/téléphone/email) — comblé par `sellerContact`
 *    (`build-semantic-invoice.ts`), lui-même alimenté par `Company.phone`/`Company.email` (colonnes
 *    NON-NULLABLES existantes) et `Company.name` pour le nom du point de contact. AUCUN champ neuf
 *    requis : tout vendeur réel les a déjà.
 *  - BR-DE-1/BR-DE-23-a/BR-DE-23-b (fatal): BG-16/BG-17 (`cac:PaymentMeans`/`PayeeFinancialAccount`).
 *    Comblé par `sellerPaymentMeans`, alimenté par la NOUVELLE colonne `Company.iban` (optionnelle,
 *    migration des deux bases — voir schema.prisma). Absent → refus nommé BR-DE-1, en citant le champ
 *    IBAN à remplir (voir le message ci-dessous).
 *  - BR-DE-3/4/8/9/14 (fatal): ville/code postal vendeur+acheteur non vides, taux de TVA non vide —
 *    déjà TOUJOURS satisfaits par le modèle existant (Company/Client `city`/`postalCode` sont des
 *    colonnes non-nullables ; `cbc:Percent` est déjà toujours émis par `build-semantic-invoice.ts`).
 *  - BR-DE-16 (fatal, conditionnel aux codes TVA S/Z/E/AE/K/G/L/M) : nécessite BT-31 (TVA vendeur) ou
 *    BG-11 — déjà couvert par le layer DE BASE (BR-S-02/BR-Z-02 du Schematron EN16931 lui-même
 *    refusent déjà un vendeur sans TVA dès qu'une ligne est à un taux standard/zéro — voir
 *    `build-semantic-invoice.ts`'s en-tête, section "VAT category").
 *  - Le reste des BR-DE-* / BR-DEX-* / BR-DE-CVD-* fatals (22, DEX-*, CVD-*) ne s'activent que pour des
 *    scénarios ce pont ne construit pas du tout (pièces jointes, sous-lignes DEX, véhicules CVD) —
 *    jamais déclenchés par une facture normale, donc rien à combler.
 *
 * ## DÉCISION : le delta est BLOQUANT (contrairement au repère)
 *
 * Au repère `avant-refonte-documents` (`compliance/providers/format/providers.ts`), le delta XRechnung
 * tournait en NON-bloquant — sa propre justification écrite était que "la donnée n'existe pas dans le
 * modèle" (pas de Leitweg-ID, pas de contact vendeur structuré, pas d'IBAN). Cette justification NE
 * TIENT PLUS : les trois champs existent désormais (Company.phone/email déjà là, Company.iban ajouté
 * par cette tâche, Leitweg-ID via l'overlay DE) et un refus NOMME précisément lequel manque et où le
 * remplir. Faire tourner ce delta en non-bloquant aujourd'hui ferait exactement ce que ce projet
 * refuse ailleurs (voir `format-registry.ts`, `structural-check.ts`) : servir un artefact qu'un
 * partenaire allemand rejettera, en prétendant qu'il est valide. Le delta est donc BLOQUANT, comme
 * tous les autres gates de ce registre (structurel, EN16931 de base, Peppol).
 */
import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentFormatBuildResult, DocumentFormatParty, DocumentFormatProvider } from './format-provider';
import { buildEuInvoiceForDocument, newEuInvoiceService } from './shared-build';
import { validateStructural } from './structural-check';
import { EN16931_UBL_SCH, validateSchematron, XRECHNUNG_UBL_SCH } from './vendored/validate-schematron';

/**
 * Read VERBATIM from the vendored delta's own `<let name="XR-CIUS-ID">` (BR-DE-21, warning-level,
 * accepts this exact value): `concat('urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:
 * xrechnung_', $XR-MAJOR-MINOR-VERSION)` with `$XR-MAJOR-MINOR-VERSION = '3.0'`. The plain "compliant"
 * profile — never the extension (`#conformant#...`) or CVD variants the same `<let>` block also
 * declares, neither of which this bridge builds anything for.
 */
const XRECHNUNG_CUSTOMIZATION_ID = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';

async function build(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
): Promise<DocumentFormatBuildResult> {
  const euInvoice = buildEuInvoiceForDocument(descriptor, document, company, client, {
    customizationId: XRECHNUNG_CUSTOMIZATION_ID,
  });

  const service = newEuInvoiceService();
  const xml = (await service.generate(euInvoice, { format: 'UBL', lang: 'en' })) as string;

  const structural = validateStructural(xml, 'ubl');
  if (!structural.valid) {
    return { bytes: new TextEncoder().encode(xml), validation: { valid: false, errors: structural.errors } };
  }

  // BOTH gates run, and BOTH must pass — see this file's own header, "DÉCISION : le delta est
  // BLOQUANT". An artifact that trips a single BR-DE-* is never served.
  const base = validateSchematron(xml, EN16931_UBL_SCH);
  const delta = validateSchematron(xml, XRECHNUNG_UBL_SCH);
  const errors = [
    ...base.errors.map((e) => `${e.id}: ${e.message}`),
    ...delta.errors.map((e) => `${e.id}: ${e.message}`),
  ];

  return {
    bytes: new TextEncoder().encode(xml),
    validation: { valid: base.valid && delta.valid, errors },
  };
}

export const xrechnungFormatProvider: DocumentFormatProvider = {
  id: 'xrechnung',
  syntax: 'XRECHNUNG_UBL',
  mime: 'application/xml',
  build,
};
