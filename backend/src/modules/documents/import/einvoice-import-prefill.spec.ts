/**
 * Import pre-fill (issue #758), proven against five REAL structured samples committed under
 * `__fixtures__/`: a CII XML and a UBL XML produced by this repository's own outbound providers
 * (each gated by the vendored EN 16931 Schematron when generated), and three Factur-X PDFs produced
 * by `@e-invoice-eu/core` at the MINIMUM, BASIC and EN 16931 profiles from the same semantic
 * invoice. The parties and amounts are fictional; nothing here came from a customer.
 *
 * The refusals are as important as the happy paths: a file whose own arithmetic is inconsistent, or
 * whose line carries a charge the import form cannot represent, must be refused, never guessed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';

import { extractImportFields } from '../received-invoices/extraction';
import { buildPrefillDraft } from './einvoice-import-prefill';

const FIXTURES = join(__dirname, '__fixtures__');
const readFixture = (name: string): Uint8Array => readFileSync(join(FIXTURES, name));
const readXml = (name: string): string => readFileSync(join(FIXTURES, name), 'utf-8');

const EXPECTED_LINES = [
  {
    description: 'Conseil stratégique',
    quantity: 10,
    unit: 'HUR',
    unitPrice: 1200,
    vatRate: '20',
  },
  { description: 'Formation équipe', quantity: 2, unit: 'DAY', unitPrice: 800, vatRate: '20' },
];

describe('import pre-fill from a structured e-invoice', () => {
  it.each([
    ['CII', 'sample.cii.xml', 'application/xml', 'CII'],
    ['UBL', 'sample.ubl.xml', 'application/xml', 'UBL'],
    ['Factur-X EN 16931', 'factur-x-en16931.pdf', 'application/pdf', 'FACTURX_CII'],
    ['Factur-X BASIC', 'factur-x-basic.pdf', 'application/pdf', 'FACTURX_CII'],
  ])('%s: every form field is read and the totals are verified', async (_label, file, mime, syntax) => {
    const extraction = await extractImportFields(readFixture(file), mime, file);
    expect(extraction.syntax).toBe(syntax);

    const draft = buildPrefillDraft('invoice', extraction);

    expect(draft.syntax).toBe(syntax);
    expect(draft.originalNumber).toBe('INV-2026-0001');
    expect(draft.fields).toMatchObject({
      issueDate: '2026-08-30',
      currency: 'EUR',
      notes: 'Merci de votre confiance.',
      lines: EXPECTED_LINES,
    });
    expect(draft.totals).toEqual({ net: 13600, vat: 2720, gross: 16320, linesNet: 13600, linesVat: 2720 });
    expect(draft.clientProposal).toMatchObject({
      name: 'Acme GmbH',
      vatId: 'DE123456789',
      countryCode: 'DE',
      currency: 'EUR',
    });
    // The seller's own number is the original number; the buyer is never mistaken for the seller.
    expect(draft.buyer).toEqual({ name: 'Acme GmbH', vatId: 'DE123456789' });
  });

  it('Factur-X MINIMUM: header and totals are read, and the missing lines are a warning, never invented', async () => {
    const extraction = await extractImportFields(
      readFixture('factur-x-minimum.pdf'),
      'application/pdf',
      'factur-x-minimum.pdf',
    );
    expect(extraction.syntax).toBe('FACTURX_CII');

    const draft = buildPrefillDraft('invoice', extraction);

    expect(draft.originalNumber).toBe('INV-2026-0001');
    expect(draft.fields.lines).toEqual([]);
    expect(draft.totals).toEqual({ net: 13600, vat: 2720, gross: 16320 });
    expect(draft.warnings.join(' ')).toMatch(/carries no invoice lines/);
    expect(draft.clientProposal?.name).toBe('Acme GmbH');
  });

  it('a file whose header totals do not add up is refused, never imported with a wrong amount', async () => {
    const xml = readXml('sample.cii.xml').replace(
      /<ram:GrandTotalAmount>16320\.00<\/ram:GrandTotalAmount>/,
      '<ram:GrandTotalAmount>16000.00</ram:GrandTotalAmount>',
    );
    const extraction = await extractImportFields(new TextEncoder().encode(xml), 'application/xml', 'x.xml');
    expect(() => buildPrefillDraft('invoice', extraction)).toThrow(/totals do not add up/);
  });

  it('a line whose stated net exceeds quantity x unit price is refused, never silently dropped', async () => {
    const xml = readXml('sample.cii.xml').replace(
      /<ram:LineTotalAmount>12000\.00<\/ram:LineTotalAmount>/,
      '<ram:LineTotalAmount>13000.00</ram:LineTotalAmount>',
    );
    const extraction = await extractImportFields(new TextEncoder().encode(xml), 'application/xml', 'x.xml');
    expect(() => buildPrefillDraft('invoice', extraction)).toThrow(/line-level charge/);
  });

  it('an invoice file imported as a credit note is refused by name', async () => {
    const extraction = await extractImportFields(
      readFixture('sample.cii.xml'),
      'application/xml',
      'sample.cii.xml',
    );
    expect(() => buildPrefillDraft('credit-note', extraction)).toThrow(/you are importing a credit note/);
  });

  it('an unrecognized file is refused with a plain explanation', async () => {
    const extraction = await extractImportFields(
      new TextEncoder().encode('<?xml version="1.0"?><SomethingElse><Foo>bar</Foo></SomethingElse>'),
      'application/xml',
      'x.xml',
    );
    expect(() => buildPrefillDraft('invoice', extraction)).toThrow(BadRequestException);
    expect(() => buildPrefillDraft('invoice', extraction)).toThrow(/not a recognized Factur-X, CII or UBL/);
  });
});
