import { DocumentTypeDescriptor } from '@/modules/documents/descriptors/types';
import { DocumentTotals } from '@/modules/documents/totals/compute-totals';

/**
 * A FIXED, self-contained sample invoice — what `branding.service.ts#preview` renders through the
 * REAL `documents/rendering/render-html.ts` (never a second, divergent rendering path) to preview a
 * company's CURRENT branding on the settings screen.
 *
 * Deliberately NOT the real, registered "invoice" descriptor
 * (`documents/descriptors/invoice.descriptor.ts`): that one's `client`/`origin` fields are
 * 'reference' kinds needing a live DB lookup (`EntityReferenceRegistry`) — a branding preview must
 * work for a brand-new company with zero clients or invoices on file, so every field here is a plain
 * kind ('text'/'date'/'array'/'select'/'longText') that needs nothing but the literal sample data
 * below. `id: 'branding-preview'` is never registered in any `DocumentTypeRegistry` — this descriptor
 * exists only to be handed straight to `renderDocumentHtml`, which reads nothing but `label`/`fields`.
 */
export const SAMPLE_PREVIEW_DESCRIPTOR: DocumentTypeDescriptor = {
  id: 'branding-preview',
  label: 'Invoice',
  actions: [],
  fields: [
    { key: 'client', kind: 'text', label: 'Client' },
    { key: 'issueDate', kind: 'date', label: 'Issue date' },
    { key: 'dueDate', kind: 'date', label: 'Due date' },
    { key: 'currency', kind: 'select', label: 'Currency', options: [{ value: 'EUR', label: 'EUR' }] },
    {
      key: 'items',
      kind: 'array',
      label: 'Items',
      fields: [
        { key: 'description', kind: 'text', label: 'Description' },
        { key: 'quantity', kind: 'number', label: 'Quantity' },
        { key: 'unitPrice', kind: 'money', label: 'Unit price', currencyField: 'currency' },
      ],
    },
    { key: 'notes', kind: 'longText', label: 'Notes' },
  ],
};

export const SAMPLE_PREVIEW_INSTANCE = {
  id: 'branding-preview',
  status: 'draft',
  createdAt: new Date('2026-01-15T00:00:00.000Z'),
  displayNumber: 'INV-2026-0001',
  data: {
    client: 'Sample Client SARL',
    issueDate: '2026-01-15',
    dueDate: '2026-02-14',
    currency: 'EUR',
    items: [
      { description: 'Consulting services', quantity: 4, unitPrice: 450 },
      { description: 'Software license', quantity: 1, unitPrice: 1200 },
    ],
    notes: 'Thank you for your business.',
  },
};

/** 4×450 + 1×1200 = 3000.00 EUR net, at a flat 20% — hand-computed here rather than run through
 *  `computeDocumentTotals` (which would need the descriptor's generic array-field detection to agree
 *  with itself): a FIXED preview has no reason to depend on that machinery at all. */
export const SAMPLE_PREVIEW_TOTALS: DocumentTotals = {
  currency: 'EUR',
  lines: [],
  netMinor: 300000,
  vatMinor: 60000,
  grossMinor: 360000,
  vatBreakdown: [{ ratePercent: 20, baseMinor: 300000, vatMinor: 60000 }],
  warnings: [],
};
