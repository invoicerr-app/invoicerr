/**
 * The case that could not be made valid: FR -> US services, out of scope of French VAT.
 *
 * The engine resolves category O (CGI art. 259-1°, Directive 2006/112 art. 44). The renderer used
 * to write Z. BR-Z-02 then demanded the seller VAT identifier and BR-O-02 forbade it, so the
 * document was refused whichever way the company was configured — and `08-payments.cy.ts` hit it as
 * a 400 on POST /api/invoices/send.
 *
 * This asserts the fix where it has to hold: against the vendored EN 16931 Schematron, not against
 * the renderer's own opinion of itself.
 */
import { FormatProviderRegistry } from './registry';
import { FR_B2B_STANDARD } from './__fixtures__/invoices';
import { makeArtifactPort } from '../../__fixtures__/artifact-port';
import { RecordingComplianceLogger } from '../../execution/logger';
import { resolve } from '../../engine/compliance-engine';
import type { InvoiceRenderData } from '../../../modules/invoice-rendering/invoice-rendering.service';

/** French supplier, US business buyer, a service. The engine's verdict for this is O. */
function outOfScope(withSellerVat: boolean): InvoiceRenderData {
  const base = FR_B2B_STANDARD.data;
  return {
    ...base,
    company: {
      ...base.company,
      partyIdentifiers: withSellerVat
        ? base.company.partyIdentifiers
        : (base.company.partyIdentifiers ?? []).filter((p: { scheme: string }) => p.scheme !== 'VAT'),
    },
    client: {
      ...base.client,
      country: 'United States',
      city: 'New York',
      postalCode: '10001',
      partyIdentifiers: [],
    },
    items: base.items.map((i: Record<string, unknown>) => ({ ...i, vatRate: 0, vatCategory: 'O' })),
  } as unknown as InvoiceRenderData;
}

const ctx = (externalRef: string) =>
  ({
    supplier: {
      legalName: 'FR Co',
      countryCode: 'FR',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'FR12345678901', validated: true }],
    },
    buyer: { legalName: 'US Buyer', countryCode: 'US', role: 'B2B', identifiers: [] },
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' }],
    issueDate: new Date('2027-01-15'),
    currency: 'EUR',
    externalRef,
  }) as never;

async function validateCii(externalRef: string, withSellerVat: boolean) {
  const formats = new FormatProviderRegistry({
    artifacts: makeArtifactPort(() => outOfScope(withSellerVat)),
  });
  const c = ctx(externalRef);
  const artifacts = await formats.buildAll(c, resolve(c), new RecordingComplianceLogger());
  return artifacts.find((a) => a.syntax === 'EN16931_CII')!.validation!;
}

describe('category O — the document that used to be unsatisfiable', () => {
  it('the engine still says O for FR -> US services', () => {
    expect(resolve(ctx('o-engine') as never).tax.lines[0].treatment.components[0].category).toBe('O');
  });

  it('BR-Z-02 no longer fires, and the document validates outright', async () => {
    const report = await validateCii('o-no-vat', false);
    expect(report.errors.join(' ')).not.toContain('BR-Z-02');
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  }, 30_000);

  it('a company that HAS a VAT number can still issue it — BR-O-02 does not fire', async () => {
    // The half that makes the fix usable. BR-O-02 forbids BT-31 on an O document, and every French
    // company has a VAT number, so leaving it in would have moved the deadlock rather than removed
    // it: refused for having the identifier instead of refused for lacking it. The renderer omits
    // the identifier when the document is out of scope, which is what the rule asks for.
    const report = await validateCii('o-with-vat', true);
    expect(report.errors.join(' ')).not.toContain('BR-O-02');
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  }, 30_000);
});
