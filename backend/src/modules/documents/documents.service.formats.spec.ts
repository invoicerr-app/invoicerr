import { vi, type Mock } from 'vitest';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotImplementedException,
} from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerInvoiceActions } from './actions/invoice-actions';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { buildCreditNoteDescriptor } from './descriptors/credit-note.descriptor';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { ciiFormatProvider } from './formats/cii-provider';
import { FormatProviderRegistry } from './formats/format-registry';
import { ublFormatProvider } from './formats/ubl-provider';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import { TransportRegistry } from './transports/transport-registry';

vi.mock('./persistence');
vi.mock('./country-policy/country-policy');

// This is the ONE spec in the module that reaches Prisma from `documents.service.ts` itself
// (`downloadDocumentFormat`'s own company/client lookups, not extracted into a separately-mockable
// module the way `renderInstancePdf` delegates to `rendering/render-instance-pdf.ts`) — mocked here
// directly, the same "mock the module boundary, not a re-implementation of Prisma" discipline every
// other `vi.mock` in this file already holds.
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { company: { findUnique: vi.fn() }, client: { findFirst: vi.fn() } },
}));

// `vi.mock`'s factory result IS what `import prisma from '@/prisma/prisma.service'` resolves to
// (hoisted before this file's own imports, same as `persistence`/`countryPolicy` below) — resolved
// once, in `beforeAll`, rather than the synchronous require-the-mock helper Jest itself provided for
// this (Vitest's own equivalent, `vi.importMock`, is async: it goes through Vite's SSR module loader,
// not Node's `require`).
let prismaMock: { company: { findUnique: Mock }; client: { findFirst: Mock } };
beforeAll(async () => {
  prismaMock = (await vi.importMock<{ default: typeof prismaMock }>('@/prisma/prisma.service')).default;
});

/**
 * Proves normalized-format downloads (EN 16931) at the SERVICE layer — the four gates
 * (country 403 → status 409 → implementation 501 → validation 400) composed exactly the way
 * `invoice.descriptor.ts`'s own "download-xml" comment and `documents.service.ts
 * #downloadDocumentFormat`'s own header describe. `formats/providers.spec.ts` and
 * `formats/pitfalls.spec.ts` already prove the BUILD+VALIDATE pipeline itself against the REAL
 * vendored Schematron — this file proves the SERVICE composes it correctly with the rest of the
 * document machinery (ownership, status, country policy), using the SAME real providers (never
 * mocked): a passing test here is a genuine, un-mocked EN 16931 build, exactly like `providers.spec.ts`.
 */
function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());
  typeRegistry.register(buildCreditNoteDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };
  const transportRegistry = new TransportRegistry();
  const actionRegistry = new ActionRegistry();
  registerInvoiceActions(actionRegistry, { transportRegistry, queueDispatcher });

  const formatProviderRegistry = new FormatProviderRegistry();
  formatProviderRegistry.register(ciiFormatProvider);
  formatProviderRegistry.register(ublFormatProvider);

  const service = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    transportRegistry,
    new ContributionRegistry(),
    undefined,
    undefined,
    formatProviderRegistry,
  );
  return { service };
}

const VALID_DATA = {
  client: 'client-1',
  issueDate: '2026-08-30',
  dueDate: '2026-09-30',
  currency: 'EUR',
  lines: [{ description: 'Conseil', quantity: 10, unit: 'hour', unitPrice: 1200, vatRate: '20' }],
};

const SELLER_ROW = {
  name: 'Dupont Consulting SARL',
  address: '12 Rue de la Paix',
  addressLine2: null,
  city: 'Paris',
  postalCode: '75002',
  country: 'France',
  email: 'contact@dupont-consulting.example',
  phone: '+33102030405',
  partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
};

const SELLER_ROW_NO_VAT = { ...SELLER_ROW, partyIdentifiers: [] };

const BUYER_ROW = {
  name: 'Acme GmbH',
  contactFirstname: null,
  contactLastname: null,
  contactEmail: null,
  contactPhone: null,
  address: 'Friedrichstraße 42',
  addressLine2: null,
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};

function mockDocument(
  overrides: Partial<{ status: string; displayNumber: string | null; number: number | null; data: unknown }>,
) {
  (persistence.findOwnedDocument as Mock).mockResolvedValue({
    id: 'doc-1',
    typeId: 'invoice',
    status: 'sent',
    data: VALID_DATA,
    createdAt: new Date(),
    updatedAt: new Date(),
    displayNumber: 'INV-2026-0001',
    number: 1,
    ...overrides,
  });
}

describe('DocumentsService#downloadDocumentFormat — the four gates, un-mocked build+validate', () => {
  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as Mock).mockResolvedValue({ allowed: true });
    prismaMock.company.findUnique.mockResolvedValue(SELLER_ROW);
    prismaMock.client.findFirst.mockResolvedValue(BUYER_ROW);
  });
  afterEach(() => vi.resetAllMocks());

  it('gate 1 (403): the country policy refuses the action', async () => {
    (countryPolicy.evaluateCountryPolicy as Mock).mockResolvedValue({
      allowed: false,
      reason: 'blocked for this country',
    });
    mockDocument({});
    const { service } = buildService();
    await expect(service.downloadDocumentFormat('company-1', 'invoice', 'doc-1', 'cii')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('gate 2 (409): a draft (never numbered) refuses, and says WHY — the "a draft with no number refuses, and says so" requirement', async () => {
    mockDocument({ status: 'draft', displayNumber: null, number: null });
    const { service } = buildService();
    await expect(service.downloadDocumentFormat('company-1', 'invoice', 'doc-1', 'cii')).rejects.toThrow(
      ConflictException,
    );
    await expect(service.downloadDocumentFormat('company-1', 'invoice', 'doc-1', 'cii')).rejects.toThrow(
      /definitive invoice number/,
    );
  });

  it('gate 3 (501): an unknown/unimplemented syntax refuses, naming the known ones', async () => {
    mockDocument({});
    const { service } = buildService();
    await expect(
      service.downloadDocumentFormat('company-1', 'invoice', 'doc-1', 'xrechnung'),
    ).rejects.toThrow(NotImplementedException);
  });

  it('gate 4 (400) — THE GATE: an invalid artifact (seller with no VAT id, BR-S-02) is NEVER served', async () => {
    mockDocument({});
    prismaMock.company.findUnique.mockResolvedValue(SELLER_ROW_NO_VAT);
    const { service } = buildService();

    await expect(service.downloadDocumentFormat('company-1', 'invoice', 'doc-1', 'cii')).rejects.toThrow(
      BadRequestException,
    );
    // Citing the rule — never a bare "invalid": a gate, not a report.
    try {
      await service.downloadDocumentFormat('company-1', 'invoice', 'doc-1', 'cii');
      expect.unreachable('expected a BadRequestException');
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as { errors: string[] };
      expect(response.errors.join(' ')).toContain('BR-S-02');
    }
  }, 30_000);

  // USER DECISION (2026-09-01, "the unresolved seller country was silently falling back to 'FR'",
  // now RESOLVED) — `download-xml` shares `resolveInvoiceCrossBorderTax` with the
  // "send" preflight/deliver path (`tax/load-and-resolve.ts`'s own header: "both real call sites...
  // share this"), so this is the SECOND of the two named entry points, proven directly at
  // the SERVICE layer rather than only at the pure resolver (`tax/resolve-invoice-tax.spec.ts`).
  it('gate 4 (400) — an unresolvable SELLER country blocks, named, before any artifact is built or served', async () => {
    mockDocument({});
    prismaMock.company.findUnique.mockResolvedValue({ ...SELLER_ROW, country: '', countryCode: null });
    const { service } = buildService();

    await expect(service.downloadDocumentFormat('company-1', 'invoice', 'doc-1', 'cii')).rejects.toThrow(
      BadRequestException,
    );
    try {
      await service.downloadDocumentFormat('company-1', 'invoice', 'doc-1', 'cii');
      expect.unreachable('expected a BadRequestException');
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as { message: string };
      expect(response.message).toMatch(/seller's own country could not be determined/);
    }
  });

  it('the happy path: a real CII artifact is built, validated, and served', async () => {
    mockDocument({});
    const { service } = buildService();
    const result = await service.downloadDocumentFormat('company-1', 'invoice', 'doc-1', 'cii');
    expect(result.mime).toBe('application/xml');
    expect(result.filename).toBe('INV-2026-0001-cii.xml');
    const xml = Buffer.from(result.bytes).toString('utf-8');
    expect(xml).toContain('INV-2026-0001');
  }, 30_000);

  it('the happy path: a real UBL artifact is built, validated, and served', async () => {
    mockDocument({});
    const { service } = buildService();
    const result = await service.downloadDocumentFormat('company-1', 'invoice', 'doc-1', 'ubl');
    expect(result.mime).toBe('application/xml');
    expect(result.filename).toBe('INV-2026-0001-ubl.xml');
  }, 30_000);
});

/**
 * Issue #472 - a credit note through the same gates, built from the invoice it corrects
 * (`formats/credit-note-source.ts`): the corrected invoice's buyer and selected lines, priced with the
 * invoice's own descriptor, BT-3 381 and BG-3 naming that invoice.
 */
describe('DocumentsService#downloadDocumentFormat - a credit note (issue #472)', () => {
  /** The invoice: two lines, the second discounted 10%. Its row ids are what `correctedLines` points at. */
  const INVOICE_DATA = {
    client: 'client-1',
    issueDate: '2026-08-30',
    dueDate: '2026-09-30',
    currency: 'EUR',
    lines: [
      { $rowId: 'row-a', description: 'Conseil', quantity: 10, unit: 'hour', unitPrice: 1200, vatRate: '20' },
      {
        $rowId: 'row-b',
        description: 'Formation',
        quantity: 2,
        unit: 'day',
        unitPrice: 800,
        vatRate: '20',
        discountPercent: 10,
      },
    ],
  };
  /** Credits ONLY the discounted line: 2 x 800 - 10% = 1440.00 net, 288.00 VAT, 1728.00 gross - the
   *  figure `settlement/credits.ts#computeCreditedAmountMinor` subtracts from the invoice too. */
  const CREDIT_NOTE_DATA = {
    invoice: 'inv-1',
    correctedLines: ['row-b'],
    issueDate: '2026-09-20',
    currency: 'EUR',
    reason: 'Formation annulée',
    lines: [],
  };

  function mockDocuments(
    creditNote: Partial<{ status: string; displayNumber: string | null; data: unknown }> = {},
    invoice: Partial<{ displayNumber: string | null; data: unknown }> = {},
  ) {
    (persistence.findOwnedDocument as Mock).mockImplementation(
      async (_companyId, typeId: string, id: string) =>
        typeId === 'invoice'
          ? {
              id,
              typeId: 'invoice',
              status: 'sent',
              data: INVOICE_DATA,
              createdAt: new Date(),
              updatedAt: new Date(),
              displayNumber: 'INVOICE-2026-0007',
              number: 7,
              ...invoice,
            }
          : {
              id,
              typeId: 'credit-note',
              status: 'sent',
              data: CREDIT_NOTE_DATA,
              createdAt: new Date(),
              updatedAt: new Date(),
              displayNumber: 'CREDIT-NOTE-2026-0001',
              number: 1,
              ...creditNote,
            },
    );
  }

  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as Mock).mockResolvedValue({ allowed: true });
    prismaMock.company.findUnique.mockResolvedValue(SELLER_ROW);
    prismaMock.client.findFirst.mockResolvedValue(BUYER_ROW);
  });
  afterEach(() => vi.resetAllMocks());

  it('serves a real, validated UBL <CreditNote> (381) naming the corrected invoice, for the corrected line only', async () => {
    mockDocuments();
    const { service } = buildService();
    const { bytes, filename } = await service.downloadDocumentFormat(
      'company-1',
      'credit-note',
      'cn-1',
      'ubl',
    );
    const xml = Buffer.from(bytes).toString('utf-8');

    expect(filename).toBe('CREDIT-NOTE-2026-0001-ubl.xml');
    expect(xml).toMatch(/<CreditNote[ >]/);
    expect(xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(xml).toContain('<cbc:ID>CREDIT-NOTE-2026-0001</cbc:ID>');
    expect(xml).toContain('<cbc:IssueDate>2026-09-20</cbc:IssueDate>');
    expect(xml).toMatch(
      /<cac:InvoiceDocumentReference>\s*<cbc:ID>INVOICE-2026-0007<\/cbc:ID>\s*<cbc:IssueDate>2026-08-30<\/cbc:IssueDate>/,
    );
    // The invoice's own discount counts (invoice descriptor pricing), and only the selected row.
    expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="EUR">1440.00</cbc:TaxExclusiveAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">1728.00</cbc:PayableAmount>');
    expect(xml).not.toContain('Conseil');
    // The buyer is the corrected invoice's client, looked up tenant-scoped.
    expect(prismaMock.client.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'client-1', companyId: 'company-1' } }),
    );
  }, 30_000);

  it('serves a real, validated CII (TypeCode 381, InvoiceReferencedDocument)', async () => {
    mockDocuments();
    const { service } = buildService();
    const { bytes } = await service.downloadDocumentFormat('company-1', 'credit-note', 'cn-1', 'cii');
    const xml = Buffer.from(bytes).toString('utf-8');
    expect(xml).toContain('<ram:TypeCode>381</ram:TypeCode>');
    expect(xml).toContain('<ram:IssuerAssignedID>INVOICE-2026-0007</ram:IssuerAssignedID>');
  }, 30_000);

  it('409: a LEGACY credit note (sent, issued without a number) gets no file at all', async () => {
    mockDocuments({ displayNumber: null });
    const { service } = buildService();
    await expect(service.downloadDocumentFormat('company-1', 'credit-note', 'cn-1', 'ubl')).rejects.toThrow(
      ConflictException,
    );
    await expect(service.downloadDocumentFormat('company-1', 'credit-note', 'cn-1', 'ubl')).rejects.toThrow(
      /issued without a number/,
    );
  });

  it('400: a FREE credit note (no invoice) has no buyer, so no file - and says so', async () => {
    mockDocuments({
      data: {
        issueDate: '2026-09-20',
        currency: 'EUR',
        reason: 'Geste',
        lines: [{ description: 'x', quantity: 1, unitPrice: 10, vatRate: '20' }],
      },
    });
    const { service } = buildService();
    await expect(service.downloadDocumentFormat('company-1', 'credit-note', 'cn-1', 'ubl')).rejects.toThrow(
      /FREE credit note/,
    );
  });

  it('400: a corrected invoice with no number of its own cannot be referenced (BG-3)', async () => {
    mockDocuments({}, { displayNumber: null });
    const { service } = buildService();
    await expect(service.downloadDocumentFormat('company-1', 'credit-note', 'cn-1', 'ubl')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('501: fa3 is not offered for a credit note, even though the registry could know it', async () => {
    mockDocuments();
    const { service } = buildService();
    await expect(service.downloadDocumentFormat('company-1', 'credit-note', 'cn-1', 'fa3')).rejects.toThrow(
      /not offered for document type "credit-note"/,
    );
  });
});
