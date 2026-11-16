/**
 * Vendor export profiles: one record per (tool, export type), never a branch in code.
 *
 * Each tool's profiles are added with the mapping that reads them, one tool at a time, each with
 * the help-centre sources its column names come from. Detection order matters: declare the most
 * specific header set first, because `detectVendorExport` returns the first full match.
 *
 * Tiime: the client and invoice exports are each one XLSX sheet, delivered inside a ZIP archive
 * that may also hold the invoice PDFs. The headers below are copied from sample exports sent by
 * Tiime's support; `__fixtures__/tiime-*.xlsx` are those files with personal data replaced.
 * https://support.tiime.fr/fr/articles/26190-comment-exporter-mes-factures-devis-et-clients
 *
 * Abby, sources checked 2026-11-08:
 *  - "Comment exporter ses donnees sur Abby": contacts are exported as CSV or Excel; invoices,
 *    quotes and credit notes are exported as PDF only.
 *    https://aide.abby.fr/fr/articles/6899224-comment-exporter-ses-donnees-sur-abby
 *  - "Comment importer mes clients sur Abby" (the contact column names Abby itself prints):
 *    https://aide.abby.fr/fr/articles/8772903-comment-importer-mes-clients-sur-abby
 *
 * No real export was available while writing this, so the fixtures under `__fixtures__/` are
 * SYNTHETIC and reproduce the documented shapes, not a captured account. The profiles accept wide
 * header aliases for that reason: a real export whose headers differ in an accent or a word still
 * maps, and anything genuinely unknown is refused instead of guessed.
 */
import {
  UnsupportedVendorExport,
  VendorExportKind,
  VendorExportProfile,
  VendorId,
} from './vendor-export.types';

export const VENDOR_EXPORT_PROFILES: VendorExportProfile[] = [
  {
    id: 'tiime-clients',
    vendor: 'tiime',
    vendorLabel: 'Tiime',
    kind: 'clients',
    label: 'Tiime client export',
    signature: [['nom'], ['siren siret'], ['facture ttc'], ['encours']],
    columns: {
      // One display name for both companies and people: Tiime has no type or first-name column.
      name: ['nom'],
      contactEmail: ['email'],
      contactPhone: ['telephone'],
      registrationNumber: ['SIREN/SIRET'],
      address: ['adresse'],
      addressLine2: ["complément d'adresse"],
      city: ['ville'],
      postalCode: ['code postal'],
      // Printed as an ISO code (FR, BE); the client mapping derives the code from a two-letter country.
      country: ['pays'],
    },
    required: ['name'],
    ignoredColumns: ['id', 'facturé TTC', 'facturé HT', 'encaissé', 'encours', 'statut'],
    defaultClientType: 'COMPANY',
    dateFormat: 'auto',
    fileTypes: ['xlsx', 'zip'],
  },
  {
    id: 'tiime-invoices',
    vendor: 'tiime',
    vendorLabel: 'Tiime',
    kind: 'invoices',
    label: 'Tiime invoice export',
    signature: [['numero de facture'], ['statut de la facture'], ['nom du client'], ['montant tva 20']],
    columns: {
      issueDate: ['date de facture'],
      originalNumber: ['numéro de facture'],
      // The export has no line detail: the title stands in for the single line's description.
      lineDescription: ['intitulé'],
      status: ['statut de la facture'],
      clientName: ['nom du client'],
      clientCountry: ['pays du client'],
      totalGross: ['montant TTC'],
      totalNet: ['montant HT'],
    },
    vatAmountColumns: [
      { rate: '20', headers: ['montant TVA 20%'] },
      { rate: '10', headers: ['montant TVA 10%'] },
      { rate: '5.5', headers: ['montant TVA 5.5%'] },
      { rate: '2.1', headers: ['montant TVA 2.1%'] },
      { rate: '8.5', headers: ['montant TVA 8.5%'] },
    ],
    required: ['originalNumber', 'issueDate', 'clientName', 'totalGross', 'totalNet'],
    ignoredColumns: ['id', 'Transaction(s) liée(s)', 'Tags'],
    defaultClientType: 'COMPANY',
    dateFormat: 'auto',
    fileTypes: ['xlsx', 'zip'],
  },
  {
    // Before `abby-individuals` on purpose: an organisation export also carries `Nom`/`Prénom`
    // (the contact), so the individuals signature would match it too and lose `Raison sociale`.
    id: 'abby-organisations',
    vendor: 'abby',
    vendorLabel: 'Abby',
    kind: 'clients',
    label: 'Abby organisations export',
    signature: [
      ['raison sociale'],
      ['adresse de facturation'],
      ['emails', 'email', 'e mail', 'telephone', 'tel'],
    ],
    columns: {
      type: ['type'],
      name: ['raison sociale', 'nom de la societe', 'societe'],
      contactLastname: ['nom', 'nom du contact'],
      contactFirstname: ['prenom', 'prenom du contact'],
      contactEmail: ['emails', 'email', 'e mail', 'adresse email', 'courriel'],
      contactPhone: ['telephone', 'tel', 'telephone fixe', 'numero de telephone'],
      address: ['adresse de facturation', 'adresse'],
      addressLine2: ['complement adresse de facturation', 'complement adresse', 'complement'],
      postalCode: ['code postal de facturation', 'code postal'],
      city: ['ville de facturation', 'ville'],
      country: ['pays de facturation', 'pays'],
      countryCode: ['code pays de facturation', 'code pays'],
      language: ['langue par defaut', 'langue'],
      currency: ['devise par defaut', 'devise'],
      vatNumber: ['numero de tva', 'tva', 'tva intracommunautaire'],
    },
    required: ['name'],
    defaultClientType: 'COMPANY',
    dateFormat: 'day-first',
    delimiterHint: ',',
  },
  {
    id: 'abby-individuals',
    vendor: 'abby',
    vendorLabel: 'Abby',
    kind: 'clients',
    label: 'Abby contacts export (individuals)',
    signature: [
      ['nom'],
      ['prenom'],
      ['adresse de facturation'],
      ['emails', 'email', 'e mail', 'telephone', 'tel'],
    ],
    columns: {
      type: ['type'],
      contactLastname: ['nom', 'nom du contact', 'nom de famille'],
      contactFirstname: ['prenom'],
      contactEmail: ['emails', 'email', 'e mail', 'adresse email', 'courriel'],
      contactPhone: ['telephone', 'tel', 'telephone fixe', 'numero de telephone'],
      address: ['adresse de facturation', 'adresse'],
      addressLine2: ['complement adresse de facturation', 'complement adresse', 'complement'],
      postalCode: ['code postal de facturation', 'code postal'],
      city: ['ville de facturation', 'ville'],
      country: ['pays de facturation', 'pays'],
      countryCode: ['code pays de facturation', 'code pays'],
      language: ['langue par defaut', 'langue'],
      currency: ['devise par defaut', 'devise'],
      vatNumber: ['numero de tva', 'tva', 'tva intracommunautaire'],
    },
    required: ['contactLastname'],
    defaultClientType: 'INDIVIDUAL',
    dateFormat: 'day-first',
    delimiterHint: ',',
  },
];

/**
 * Exports that exist but are not row-shaped. Kept as data so the user guide, the preview and a
 * future "import a PDF archive" step all quote the same fact instead of three paraphrases.
 */
export const UNSUPPORTED_VENDOR_EXPORTS: UnsupportedVendorExport[] = [
  {
    vendor: 'abby',
    kind: 'invoices',
    reason:
      'Abby exports invoices, quotes and credit notes as PDF files only. There is no invoice CSV ' +
      'to map, so import each original with the single-document Import form instead.',
    source: 'https://aide.abby.fr/fr/articles/6899224-comment-exporter-ses-donnees-sur-abby',
  },
];

export function unsupportedVendorExport(
  vendor: VendorId,
  kind: VendorExportKind,
): UnsupportedVendorExport | undefined {
  return UNSUPPORTED_VENDOR_EXPORTS.find((entry) => entry.vendor === vendor && entry.kind === kind);
}
