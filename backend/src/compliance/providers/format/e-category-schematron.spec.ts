/**
 * What the corrected derivation actually produces, judged by the Schematron and not by me.
 *
 * A French domestic line at 0% used to be called `Z`. France levies no zero rate (CGI art. 278 ter,
 * the only one, abrogated 2023-01-01), so the engine now says `E`. `E` is not a free rename: BR-E-10
 * requires an exemption reason — BT-120 text or BT-121 code — that `Z` has no place for.
 *
 * So this spec exists to answer one question honestly: does the corrected category ship a document
 * the standard refuses? The answer decides whether the fix is finished or half-built, and it is
 * written down either way.
 */
import { FormatProviderRegistry } from './registry';
import { FR_B2B_STANDARD } from './__fixtures__/invoices';
import { makeArtifactPort } from '../../__fixtures__/artifact-port';
import { RecordingComplianceLogger } from '../../execution/logger';
import { resolve } from '../../engine/compliance-engine';
import type { InvoiceRenderData } from '../../../modules/invoice-rendering/invoice-rendering.service';

/** French supplier, French business buyer, a 0% service — the domestic exemption case. */
function domesticExempt(exemptionReason?: string): InvoiceRenderData {
  const base = FR_B2B_STANDARD.data;
  return {
    ...base,
    items: base.items.map((i: Record<string, unknown>) => ({
      ...i,
      vatRate: 0,
      vatCategory: 'E',
      vatExemptionReason: exemptionReason,
    })),
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
    buyer: {
      legalName: 'FR Buyer',
      countryCode: 'FR',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'FR98765432109', validated: true }],
    },
    lines: [
      {
        id: 'l1',
        description: 'x',
        quantity: 1,
        unitNetMinor: 10000,
        supplyType: 'SERVICES',
        taxRateHint: 0,
      },
    ],
    issueDate: new Date('2026-10-15'),
    currency: 'EUR',
    externalRef,
  }) as never;

async function validateCii(externalRef: string, exemptionReason?: string) {
  const formats = new FormatProviderRegistry({
    artifacts: makeArtifactPort(() => domesticExempt(exemptionReason)),
  });
  const c = ctx(externalRef);
  const artifacts = await formats.buildAll(c, resolve(c), new RecordingComplianceLogger());
  return artifacts.find((a) => a.syntax === 'EN16931_CII')!.validation!;
}

describe('category E — the French domestic exemption', () => {
  it('the engine says E for a French domestic 0% line', () => {
    // The chain from the profile fact to the plan, at the level the renderer reads.
    expect(resolve(ctx('e-engine') as never).tax.lines[0].treatment.components[0].category).toBe('E');
  });

  it('BR-E-02 is satisfied by the seller VAT identifier, exactly as BR-Z-02 was', async () => {
    // The protection Z carried is not lost in the move: E asks the seller for the same identifier,
    // and the issuance guard already lists E among the categories that require it.
    const report = await validateCii('e-with-vat', 'VATEX-EU-132');
    expect(report.errors.join(' ')).not.toContain('BR-E-02');
  }, 30_000);

  it('WITHOUT an exemption reason the document is refused — BR-E-10', async () => {
    // The consequence of the correction, stated rather than discovered in production. This is why
    // the fix is not finished at the engine: something has to be able to SAY why the line is
    // exempt, and today nothing in the product can.
    const report = await validateCii('e-no-reason');
    expect(report.errors.join(' ')).toContain('BR-E-10');
    expect(report.valid).toBe(false);
  }, 30_000);
});
