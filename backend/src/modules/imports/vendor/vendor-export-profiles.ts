/**
 * Vendor export profiles (issue #759): one record per (tool, export type), never a branch in code.
 *
 * Sources, checked 2026-11-08:
 *  - Abby, "Comment exporter ses donnees sur Abby": contacts are exported as CSV or Excel;
 *    invoices, quotes and credit notes are exported as PDF only.
 *    https://aide.abby.fr/fr/articles/6899224-comment-exporter-ses-donnees-sur-abby
 *  - Abby, "Comment importer mes clients sur Abby" (the contact column names Abby itself prints):
 *    https://aide.abby.fr/fr/articles/8772903-comment-importer-mes-clients-sur-abby
 *  - Henrri, client export column names (Code client, Raison sociale, Nom, Prenom, Adresse,
 *    Complement d'adresse, Code postal, Ville, Telephone, Mobile, E-mail), as read by a third-party
 *    importer that reverse-engineered them from a real export:
 *    https://github.com/nicolasaustry-cpu/suivi-heures/blob/main/public/import-henrri.html
 *  - Henrri, generic accounting CSV ("ventes, paiements, TVA"): no public column list, so the
 *    invoice profile uses the documented semantic fields only.
 *    https://www.henrri.com/fonctionnalites/export-comptable/
 *  - Tiime, "Comment exporter mes factures, devis et clients": invoices, quotes and client sheets,
 *    with an unspecified CSV/Excel column list.
 *    https://support.tiime.fr/fr/articles/26190-comment-exporter-mes-factures-devis-et-clients
 *  - Tiime, client import template ("Modele_import_client.csv"): same warning, the template's own
 *    columns are not published outside the app.
 *    https://support.tiime.fr/fr/articles/26176-importer-un-fichier-client
 *
 * No real export was available while writing this, so the fixtures under
 * `backend/src/modules/imports/vendor/__fixtures__/` are SYNTHETIC and reproduce the documented
 * shapes, not a captured account. The profiles accept wide header aliases for that reason: a real
 * export whose headers differ in an accent or a word still maps, and anything genuinely unknown is
 * refused instead of guessed. This is stated again in the pull request and the user guide.
 */
import { UnsupportedVendorExport, VendorExportProfile, VendorId } from './vendor-export.types';

/** Detection order matters: the most specific header set wins. */
export const VENDOR_EXPORT_PROFILES: VendorExportProfile[] = [
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
  {
    id: 'henrri-clients',
    vendor: 'henrri',
    vendorLabel: 'Henrri',
    kind: 'clients',
    label: 'Henrri client list export',
    signature: [
      ['code client'],
      ['raison sociale', 'nom'],
      ['e mail', 'email', 'mail', 'courriel'],
      ['adresse'],
    ],
    columns: {
      type: ['type'],
      name: ['raison sociale', 'societe', 'nom de la societe'],
      contactLastname: ['nom', 'nom du contact', 'nom client'],
      contactFirstname: ['prenom', 'prenom du contact', 'prenom client'],
      contactEmail: ['e mail', 'email', 'mail', 'courriel'],
      contactPhone: ['mobile', 'portable', 'telephone', 'tel', 'telephone fixe'],
      address: ['adresse', 'adresse 1', 'adresse ligne 1'],
      addressLine2: ['complement', 'complement d adresse', 'adresse 2', 'adresse ligne 2'],
      postalCode: ['code postal', 'cp'],
      city: ['ville', 'commune', 'localite'],
      country: ['pays'],
      countryCode: ['code pays'],
      vatNumber: ['tva', 'numero de tva', 'tva intracommunautaire'],
    },
    required: ['contactLastname'],
    defaultClientType: 'COMPANY',
    dateFormat: 'day-first',
    delimiterHint: ';',
  },
  {
    id: 'tiime-clients',
    vendor: 'tiime',
    vendorLabel: 'Tiime',
    kind: 'clients',
    label: 'Tiime client sheet export',
    signature: [
      ['nom', 'raison sociale', 'societe'],
      ['email', 'e mail', 'mail', 'courriel'],
      ['telephone', 'tel', 'mobile'],
      ['adresse', 'adresse postale'],
    ],
    columns: {
      type: ['type'],
      name: ['raison sociale', 'societe', 'nom de la societe'],
      contactLastname: ['nom', 'nom du contact'],
      contactFirstname: ['prenom', 'prenom du contact'],
      contactEmail: ['email', 'e mail', 'mail', 'courriel'],
      contactPhone: ['telephone', 'tel', 'mobile', 'portable'],
      address: ['adresse', 'adresse postale', 'adresse 1'],
      addressLine2: ['complement', 'complement d adresse', 'adresse 2'],
      postalCode: ['code postal', 'cp'],
      city: ['ville', 'commune'],
      country: ['pays'],
      countryCode: ['code pays'],
      vatNumber: ['tva', 'numero de tva', 'tva intracommunautaire'],
    },
    required: ['contactLastname'],
    defaultClientType: 'COMPANY',
    dateFormat: 'day-first',
    delimiterHint: ';',
  },
  {
    id: 'henrri-invoices',
    vendor: 'henrri',
    vendorLabel: 'Henrri',
    kind: 'invoices',
    label: 'Henrri sales journal export',
    signature: [
      ['numero de facture', 'numero', 'n de facture', 'reference'],
      ['client', 'nom du client'],
      ['montant ht', 'total ht'],
      ['montant ttc', 'total ttc'],
      ['taux de tva', 'montant tva'],
    ],
    columns: {
      originalNumber: ['numero de facture', 'numero facture', 'n de facture', 'numero', 'reference'],
      issueDate: ['date', 'date de facture', 'date d emission'],
      dueDate: ['echeance', 'date d echeance'],
      currency: ['devise'],
      clientName: ['client', 'nom du client', 'raison sociale'],
      notes: ['notes', 'commentaire', 'observation'],
      lineDescription: ['designation', 'description', 'libelle'],
      lineQuantity: ['quantite', 'qte'],
      lineUnit: ['unite'],
      lineUnitPrice: ['prix unitaire ht', 'prix unitaire'],
      lineVatRate: ['taux de tva', 'taux tva'],
      totalNet: ['montant ht', 'total ht'],
      totalVat: ['montant tva', 'total tva'],
      totalGross: ['montant ttc', 'total ttc'],
      originalFileName: ['fichier', 'nom du fichier', 'fichier pdf', 'document'],
    },
    required: ['originalNumber', 'issueDate', 'clientName'],
    defaultClientType: 'COMPANY',
    dateFormat: 'day-first',
    delimiterHint: ';',
  },
  {
    id: 'tiime-invoices',
    vendor: 'tiime',
    vendorLabel: 'Tiime',
    kind: 'invoices',
    label: 'Tiime invoice list export',
    signature: [
      ['numero', 'n de facture', 'numero de facture'],
      ['date'],
      ['client', 'nom du client'],
      ['montant ttc', 'total ttc'],
      ['echeance', 'date limite'],
    ],
    columns: {
      originalNumber: ['numero', 'numero de facture', 'n de facture', 'reference'],
      issueDate: ['date', 'date de facture', 'date d emission'],
      dueDate: ['echeance', 'date d echeance', 'date limite'],
      currency: ['devise'],
      clientName: ['client', 'nom du client', 'raison sociale'],
      notes: ['notes', 'commentaire', 'objet'],
      lineDescription: ['designation', 'description', 'libelle', 'objet'],
      lineQuantity: ['quantite', 'qte'],
      lineUnit: ['unite'],
      lineUnitPrice: ['prix unitaire ht', 'prix unitaire'],
      lineVatRate: ['taux de tva', 'taux tva'],
      totalNet: ['montant ht', 'total ht'],
      totalVat: ['tva', 'montant tva'],
      totalGross: ['montant ttc', 'total ttc'],
      originalFileName: ['fichier', 'nom du fichier', 'fichier pdf', 'document'],
    },
    required: ['originalNumber', 'issueDate', 'clientName'],
    defaultClientType: 'COMPANY',
    dateFormat: 'day-first',
    delimiterHint: ';',
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
  kind: 'clients' | 'invoices',
): UnsupportedVendorExport | undefined {
  return UNSUPPORTED_VENDOR_EXPORTS.find((entry) => entry.vendor === vendor && entry.kind === kind);
}
