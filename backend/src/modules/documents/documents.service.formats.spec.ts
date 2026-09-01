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
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { ciiFormatProvider } from './formats/cii-provider';
import { FormatProviderRegistry } from './formats/format-registry';
import { ublFormatProvider } from './formats/ubl-provider';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
jest.mock('./country-policy/country-policy');

// This is the ONE spec in the module that reaches Prisma from `documents.service.ts` itself
// (`downloadDocumentFormat`'s own company/client lookups, not extracted into a separately-mockable
// module the way `renderInstancePdf` delegates to `rendering/render-instance-pdf.ts`) — mocked here
// directly, the same "mock the module boundary, not a re-implementation of Prisma" discipline every
// other `jest.mock` in this file already holds.
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { company: { findUnique: jest.fn() }, client: { findUnique: jest.fn() } },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const prismaMock = jest.requireMock('@/prisma/prisma.service').default;

/**
 * Proves item 12 ("formats normalisés EN 16931") at the SERVICE layer — the four gates
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

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };
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
  (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
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
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    prismaMock.company.findUnique.mockResolvedValue(SELLER_ROW);
    prismaMock.client.findUnique.mockResolvedValue(BUYER_ROW);
  });
  afterEach(() => jest.resetAllMocks());

  it('gate 1 (403): the country policy refuses the action', async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({
      allowed: false,
      reason: 'blocked for this country',
    });
    mockDocument({});
    const { service } = buildService();
    await expect(service.downloadDocumentFormat('company-1', 'invoice', 'doc-1', 'cii')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('gate 2 (409): a draft (never numbered) refuses, and says WHY — the "un brouillon sans numéro refuse en le disant" requirement', async () => {
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
    // Citing the rule — never a bare "invalid", per this ticket's own "gate, not a report" requirement.
    try {
      await service.downloadDocumentFormat('company-1', 'invoice', 'doc-1', 'cii');
      fail('expected a BadRequestException');
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as { errors: string[] };
      expect(response.errors.join(' ')).toContain('BR-S-02');
    }
  }, 30_000);

  // USER DECISION (2026-09-01, TODO_ISSUES.md "le pays vendeur irrésolu retombait sur 'FR'
  // silencieusement", now RÉSOLU) — `download-xml` shares `resolveInvoiceCrossBorderTax` with the
  // "send" preflight/deliver path (`tax/load-and-resolve.ts`'s own header: "both real call sites...
  // share this"), so this is the SECOND of the task's own two named entry points, proven directly at
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
      fail('expected a BadRequestException');
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
