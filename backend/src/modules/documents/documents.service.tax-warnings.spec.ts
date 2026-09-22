import { vi, type Mock } from 'vitest';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { ContributionRegistry } from './contributions/contribution-registry';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import * as taxLoadAndResolve from './tax/load-and-resolve';
import {
  resolveInvoiceCrossBorderTax,
  type InvoiceTaxPartyInput,
  type BuyerVatIdentifierInput,
} from './tax/resolve-invoice-tax';
import { TransportRegistry } from './transports/transport-registry';

/** Reaches Prisma for the row `findOwnedDocument` hands back — mocked the same way every other
 *  DocumentsService suite in this directory mocks it. */
vi.mock('./persistence');
/** `resolveInvoiceCrossBorderTaxForCompany` reaches Prisma too (the seller/buyer country + the
 *  buyer's stored VAT verdict). Mocked here NOT to fake an answer but to supply those two rows: every
 *  test below routes the mock straight into the REAL, pure `resolveInvoiceCrossBorderTax`, so the
 *  warnings asserted on are produced by the actual tax engine, never typed into this file. A spec
 *  that hardcoded the strings would go green against a service that invented its own. */
vi.mock('./tax/load-and-resolve');

/**
 * `DocumentsService.getTaxWarnings` — the READ side the cross-border tax resolver never had.
 *
 * The resolver has always recorded non-fatal caveats ("this buyer's VAT number could not be
 * confirmed, so the sale was taxed as a consumer sale"; "only the destination's STANDARD rate could
 * be applied"), and every path that called it wanted the rewritten `data` and nothing else — so the
 * array reached nobody. What this file pins is the whole chain from the engine's own verdict to what
 * the endpoint hands the document screen: the exact warnings the engine emits, unchanged, plus the
 * three silences that must stay silent (a domestic invoice, a blocked invoice, a type with no tax
 * wiring at all) so the screen never grows an empty box.
 */
function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    new ActionRegistry(),
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );
}

/** Points the mocked Prisma-aware entry point at the REAL resolver, with the seller/buyer facts this
 *  test wants it to have read out of the database. */
function resolveAs(
  seller: InvoiceTaxPartyInput,
  buyer: InvoiceTaxPartyInput,
  buyerVat?: BuyerVatIdentifierInput,
) {
  (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as Mock).mockImplementation(
    (_companyId: string, data: Record<string, unknown>) =>
      Promise.resolve(resolveInvoiceCrossBorderTax({ seller, buyer, buyerVat, data })),
  );
}

function invoiceRow(lines: Record<string, unknown>[]) {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'draft',
    data: { client: 'client-1', issueDate: '2026-01-01', currency: 'EUR', lines },
  };
}

/** 5.5% in France (CGI art. 278-0 bis), 7% in Germany (UStG § 12 Abs. 2 with Anlage 2) — the product
 *  whose reduced rate the OSS branch provably cannot reach, which is what makes its warning real. */
const BOOK_LINE = {
  description: 'Livre',
  quantity: 1,
  unit: 'unit',
  unitPrice: 40,
  vatRate: 'fr-reduced',
  supplyType: 'GOODS',
};

const CONSULTING_LINE = {
  description: 'Consulting',
  quantity: 1,
  unit: 'unit',
  unitPrice: 500,
  vatRate: '20',
  supplyType: 'SERVICES',
};

/** Widely published and checksum-valid, so the SYNTAX check passes and the test is genuinely about
 *  the missing VIES verdict rather than about a malformed number. */
const DE_SYNTACTICALLY_VALID_VAT = 'DE136695976';

describe('DocumentsService.getTaxWarnings — the caveats the tax engine records actually come out', () => {
  afterEach(() => vi.resetAllMocks());

  it('an unconfirmed buyer VAT number: the engine taxes the sale as B2C and SAYS SO', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(invoiceRow([CONSULTING_LINE]));
    resolveAs(
      { countryCode: 'FR' },
      { countryCode: 'DE' },
      {
        value: DE_SYNTACTICALLY_VALID_VAT,
        validationStatus: null,
      },
    );

    const { warnings } = await buildService().getTaxWarnings('company-1', 'invoice', 'doc-1');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/has not been confirmed valid yet/);
    // The consequence, not just the fact: this is the half that changes the tax.
    expect(warnings[0]).toMatch(/treating this buyer as B2C/);
    // Pinned WHOLE, unusually for this codebase, and only for the two warnings a user can actually
    // reach today: the document screen's own suite renders these exact strings
    // (`frontend/src/components/documents/document-tax-warnings.spec.tsx`), which it can only do
    // faithfully while the two literals agree. Rewording the engine's message is fine — it fails
    // here first, pointing at the copy that has to move with it.
    expect(warnings[0]).toBe(
      'Buyer VAT number "DE136695976" has not been confirmed valid yet (status: not checked) — ' +
        'treating this buyer as B2C until it is verified, never a silent B2B.',
    );
  });

  it('an OSS distance sale: the destination STANDARD rate was applied, and the possible over-charge is named', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(invoiceRow([BOOK_LINE]));
    resolveAs({ countryCode: 'FR', distanceSalesRegime: 'DESTINATION' }, { countryCode: 'DE' });

    const { warnings } = await buildService().getTaxWarnings('company-1', 'invoice', 'doc-1');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/STANDARD VAT rate \(19%\)/);
    expect(warnings[0]).toMatch(/reduced rates are not modelled/);
    // Pinned whole for the same reason as the warning above — the screen's own suite renders it.
    expect(warnings[0]).toBe(
      'This invoice is an intra-Community distance sale taxed in DE (EU One-Stop-Shop, Directive ' +
        "2006/112/EC art. 33(a)), so DE's STANDARD VAT rate (19%) was applied. DE's own reduced " +
        'rates are not modelled here and an invoice line carries nothing that says which products ' +
        'they cover — check the destination rate yourself if what you are selling is reduced-rated ' +
        'there, or this invoice over-charges the customer.',
    );
  });

  it('a purely domestic invoice has nothing to caveat — an EMPTY list, so the screen shows no box', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(invoiceRow([CONSULTING_LINE]));
    resolveAs({ countryCode: 'FR' }, { countryCode: 'FR' });

    expect(await buildService().getTaxWarnings('company-1', 'invoice', 'doc-1')).toEqual({ warnings: [] });
  });

  /**
   * The five named hard blocks are refusals of a SEND, delivered there as a 400 the user acts on
   * (`actions/invoice-actions.ts#runInvoiceCrossBorderTaxPreflight`). Reading a document must never
   * inherit them: a draft with no client at all is the single most common state this endpoint is
   * called in, and a 400 on it would break the document screen rather than inform it.
   */
  it('a hard block (unresolved buyer country) reads back as an empty list, never as a thrown 400', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(invoiceRow([CONSULTING_LINE]));
    resolveAs({ countryCode: 'FR' }, { countryCode: undefined, country: undefined });

    expect(await buildService().getTaxWarnings('company-1', 'invoice', 'doc-1')).toEqual({ warnings: [] });
  });

  it('a failure that is NOT a tax block still propagates — never swallowed into a reassuring empty list', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(invoiceRow([CONSULTING_LINE]));
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as Mock).mockRejectedValue(
      new Error('database unreachable'),
    );

    await expect(buildService().getTaxWarnings('company-1', 'invoice', 'doc-1')).rejects.toThrow(
      'database unreachable',
    );
  });

  it('a type the cross-border wiring never covered answers an empty list, without resolving anything', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-2',
      typeId: 'quote',
      status: 'draft',
      data: { client: 'client-1', currency: 'EUR', lines: [CONSULTING_LINE] },
    });

    expect(await buildService().getTaxWarnings('company-1', 'quote', 'doc-2')).toEqual({ warnings: [] });
    expect(taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany).not.toHaveBeenCalled();
  });

  it('the document is still scoped to the company — an id belonging to nobody here is a 404, not an empty list', async () => {
    (persistence.findOwnedDocument as Mock).mockRejectedValue(new Error('Document "doc-9" not found'));

    await expect(buildService().getTaxWarnings('company-1', 'invoice', 'doc-9')).rejects.toThrow(/not found/);
  });
});
