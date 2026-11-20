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
 */
import { VendorExportProfile } from './vendor-export.types';

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
];
