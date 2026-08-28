/**
 * C2's payoff — C1 reproduced by a TEST rather than by reading a server log.
 *
 * The BR-Z-02 finding came from the backend journal of a live e2e run: two French sends blocked by
 * a Schematron rule inside an otherwise green suite. It could not be reproduced offline, because
 * the shared artifact port rendered a FIXED document whatever context was passed to buildAll() — a
 * zero-rated context produced a 20% artifact and validation called it valid.
 *
 * With the port resolving its data per invoice id, the rendered document can be made to match the
 * case under test, and the rule can be seen firing and stopping.
 */
import { FormatProviderRegistry } from './registry';
import { FR_B2B_STANDARD } from './__fixtures__/invoices';
import { makeArtifactPort } from '../../__fixtures__/artifact-port';
import { RecordingComplianceLogger } from '../../execution/logger';
import { resolve } from '../../engine/compliance-engine';
import type { InvoiceRenderData } from '../../../modules/invoice-rendering/invoice-rendering.service';

/** The standard French fixture, with the seller's VAT identifier removed and the rate zeroed. */
function zeroRated(withSellerVat: boolean): InvoiceRenderData {
  const base = FR_B2B_STANDARD.data;
  return {
    ...base,
    company: {
      ...base.company,
      partyIdentifiers: withSellerVat
        ? base.company.partyIdentifiers
        : (base.company.partyIdentifiers ?? []).filter((p: { scheme: string }) => p.scheme !== 'VAT'),
    },
    // DOMESTIC: the standard fixture's buyer is a German company, and a 0 rate to a German
    // taxable person is REVERSE CHARGE (category AE), not zero-rated (Z) — BR-AE-02 fires instead
    // of BR-Z-02. That the category follows the document's own data is exactly what the frozen
    // fixture hid.
    client: { ...base.client, country: 'France', city: 'Lyon', postalCode: '69002' },
    items: base.items.map((i: Record<string, unknown>) => ({ ...i, vatRate: 0 })),
  } as InvoiceRenderData;
}

const ctx = (externalRef: string) =>
  ({
    supplier: {
      legalName: 'FR Co',
      countryCode: 'FR',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'FR12345678901', validated: true }],
    },
    buyer: {
      legalName: 'FR Buyer',
      countryCode: 'FR',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'FR98765432101', validated: true }],
    },
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' }],
    issueDate: new Date('2027-01-15'),
    currency: 'EUR',
    externalRef,
  }) as never;

async function validateCii(externalRef: string, withSellerVat: boolean) {
  const formats = new FormatProviderRegistry({
    artifacts: makeArtifactPort(() => zeroRated(withSellerVat)),
  });
  const c = ctx(externalRef);
  const artifacts = await formats.buildAll(c, resolve(c), new RecordingComplianceLogger());
  return artifacts.find((a) => a.syntax === 'EN16931_CII')!.validation!;
}

describe('C1 reproduced — BR-Z-02 fires on a zero-rated line without the seller VAT id', () => {
  it('without the seller VAT identifier: the CII is INVALID, and the rule names itself', async () => {
    const report = await validateCii('zero-no-vat', false);
    expect(report.valid).toBe(false);
    expect(report.errors.join(' ')).toContain('BR-Z-02');
  }, 30_000);

  it('with the seller VAT identifier: the same zero-rated document validates', async () => {
    const report = await validateCii('zero-with-vat', true);
    expect(report.errors.join(' ')).not.toContain('BR-Z-02');
  }, 30_000);
});
