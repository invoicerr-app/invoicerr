/**
 * Mandatory legal mentions — the CII/UBL half of the proof, through the REAL
 * providers (`cii-provider.ts`/`ubl-provider.ts`) and the REAL vendored EN 16931 Schematron, the
 * same discipline `providers.spec.ts` (the master proof) already holds. This is precisely
 * what changes the verdict a real superpdp deposit gets back — see
 * `../transports/pdp/pdp.live.spec.ts`'s own header for the fr:213 rejection ("BR-FR-05/BT-22 : La
 * mention relative aux frais de recouvrement (code PMT) est absente") this data exists to fix.
 */
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { computeDocumentTotals } from '../totals/compute-totals';
import { ciiFormatProvider } from './cii-provider';
import { DocumentFormatParty } from './format-provider';
import { ublFormatProvider } from './ubl-provider';

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

const FRENCH_SELLER: DocumentFormatParty = {
  name: 'Dupont Consulting SARL',
  address: '12 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'France',
  email: 'contact@dupont-consulting.example',
  partyIdentifiers: [
    { scheme: 'VAT', value: 'FR12345678901' },
    { scheme: 'LEGAL_ID', value: '12345678900017' },
  ],
};

const GERMAN_SELLER: DocumentFormatParty = {
  name: 'Muster GmbH',
  address: 'Musterstraße 1',
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};

const BUYER: DocumentFormatParty = {
  name: 'Acme GmbH',
  address: 'Friedrichstraße 42',
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};

function dataFor(issueDate: string) {
  return {
    client: 'client-1',
    issueDate,
    dueDate: issueDate,
    currency: 'EUR',
    lines: [{ description: 'Conseil', quantity: 1, unit: 'hour', unitPrice: 100, vatRate: '20' }],
  };
}

function documentFor(issueDate: string) {
  const data = dataFor(issueDate);
  return { id: 'doc-mentions', data, displayNumber: 'INV-2026-MENTIONS', status: 'sent' };
}

describe.each([
  ['CII', ciiFormatProvider] as const,
  ['UBL', ublFormatProvider] as const,
])('legal mentions on a French invoice — %s, judged by the real vendored Schematron', (label, provider) => {
  // Every `it` below that calls `provider.build` pays for a real XML generation plus a real run of
  // the vendored EN 16931 Schematron (node-schematron, XSLT-based) — the same per-call cost
  // `formats/providers.spec.ts`'s own sibling tests already budget 30_000ms for. Measured directly:
  // on an otherwise-idle box the CII variant alone runs 2.4s-4.7s (the two-build "frozen at issue
  // date" case, doing it twice, is the heaviest at ~4.7s); pinned to 2 cores with `--maxWorkers=2`
  // (this repo's own CI figure — see vitest.config.ts's own comment on why) the same test measurably
  // clears 5000ms, which is exactly the shape of the 2026-09 CI timeouts this budget exists to fix.
  // 30_000 is not a tighter guess at "how long this really takes" — it is the existing headroom the
  // rest of this test family already carries for identical work; this file simply never got it when
  // it was written, unlike its siblings.
  it('carries the three mentions (PMT/PMD/AAB) and still validates — BR-CL-08 accepts the subject codes', async () => {
    const document = documentFor('2026-08-30');
    const result = await provider.build(descriptor, document, FRENCH_SELLER, BUYER);

    expect(result.validation.errors).toEqual([]);
    expect(result.validation.valid).toBe(true);

    const xml = Buffer.from(result.bytes).toString('utf-8');
    // Subject codes: `ram:SubjectCode` for CII (post `splitCiiIncludedNotes`), `#CODE#` prefix for
    // UBL — both forms are asserted regardless of which provider is under test, since a code that
    // made it through as one shape but not the other would be exactly the kind of syntax-specific
    // regression this dual `describe.each` exists to catch.
    for (const code of ['PMT', 'PMD', 'AAB']) {
      const hasCiiShape = xml.includes(`<ram:SubjectCode>${code}</ram:SubjectCode>`);
      const hasUblShape = xml.includes(`#${code}#`);
      expect(hasCiiShape || hasUblShape).toBe(true);
    }

    // The actual legal content, not just the code — a reviewer reading the XML sees real French text.
    expect(xml).toContain('frais de recouvrement');
    expect(xml).toMatch(/40\s?€/);
    expect(xml).toContain('Escompte pour paiement anticipé');
  }, 30_000);

  it('an invoice issued 2026-06-30 prints 12,15 % — an invoice issued 2026-07-02 prints 12,40 % (frozen at issue date)', async () => {
    const firstHalf = await provider.build(descriptor, documentFor('2026-06-30'), FRENCH_SELLER, BUYER);
    const secondHalf = await provider.build(descriptor, documentFor('2026-07-02'), FRENCH_SELLER, BUYER);

    const xmlFirst = Buffer.from(firstHalf.bytes).toString('utf-8');
    const xmlSecond = Buffer.from(secondHalf.bytes).toString('utf-8');

    expect(xmlFirst).toMatch(/12,15\s?%/);
    expect(xmlFirst).not.toMatch(/12,40\s?%/);
    expect(xmlSecond).toMatch(/12,40\s?%/);
    expect(xmlSecond).not.toMatch(/12,15\s?%/);

    expect(firstHalf.validation.valid).toBe(true);
    expect(secondHalf.validation.valid).toBe(true);
  }, 30_000);

  it('a seller in a country with no mentions file (Germany) gets none of the three codes — existing behaviour untouched', async () => {
    const result = await provider.build(descriptor, documentFor('2026-08-30'), GERMAN_SELLER, BUYER);
    expect(result.validation.valid).toBe(true);

    const xml = Buffer.from(result.bytes).toString('utf-8');
    for (const code of ['PMT', 'PMD', 'AAB']) {
      expect(xml).not.toContain(`<ram:SubjectCode>${code}</ram:SubjectCode>`);
      expect(xml).not.toContain(`#${code}#`);
    }
  }, 30_000);

  it('(point 2, reprised) the amounts in the mention-carrying document are still compute-totals’ own, never a re-sum', async () => {
    const data = dataFor('2026-08-30');
    const totals = computeDocumentTotals(descriptor, data);
    const result = await provider.build(descriptor, documentFor('2026-08-30'), FRENCH_SELLER, BUYER);
    const xml = Buffer.from(result.bytes).toString('utf-8');
    expect(xml).toContain((totals.grossMinor / 100).toFixed(2));
  }, 30_000);

  // REGRESSION — Peppol BIS rule R002: `peppol-post-process.ts#mergePeppolNotesInObject` collapses the three
  // mentions into ONE `cbc:Note`, but ONLY on the Peppol BIS bridge — see that file's own header,
  // "CONFINED to this Peppol BIS bridge alone". CII and plain UBL (this describe.each's own two
  // providers) never wire that postProcessor at all (`cii-provider.ts`/`ubl-provider.ts` call
  // `service.generate` with no `postProcessor` option — see those files directly), so they must keep
  // emitting the three mentions as three SEPARATE notes, exactly as before this fix existed.
  it('THREE SEPARATE notes, still — this syntax never wires the Peppol BIS note-merge postProcessor', async () => {
    const result = await provider.build(descriptor, documentFor('2026-08-30'), FRENCH_SELLER, BUYER);
    expect(result.validation.valid).toBe(true);
    const xml = Buffer.from(result.bytes).toString('utf-8');

    const noteElementCount =
      label === 'CII'
        ? [...xml.matchAll(/<ram:IncludedNote>/g)].length
        : [...xml.matchAll(/<cbc:Note>/g)].length;
    expect(noteElementCount).toBe(3);

    // Each mention still stands on its own, complete and verbatim — never joined with another.
    expect(xml).toContain('frais de recouvrement');
    expect(xml).toContain("l'an");
    expect(xml).toContain('Escompte pour paiement anticipé : néant');
  }, 30_000);

  // THE MUTATION TARGET: an issue date before `lateFeeRate`'s own earliest catalog value used to mean
  // the XML shipped with the literal, un-interpolated "{lateFeeRate}" token baked into BT-22 — see
  // `mentions/invoice-notes.spec.ts` for the same fact proven at the resolver's own level. Here it
  // must instead be a NAMED build failure (`SemanticBuildError`, `build-semantic-invoice.ts`'s own
  // class) — the same "cannot even attempt to build" case `format-provider.ts`'s own header documents
  // for an unresolvable BT-151 — never a bare crash, and never a printed placeholder.
  it('refuses to build (SemanticBuildError, never a raw {token}) for an issue date before lateFeeRate has a value at all', async () => {
    await expect(provider.build(descriptor, documentFor('2025-11-15'), FRENCH_SELLER, BUYER)).rejects.toThrow(
      /lateFeeRate/,
    );
  });
});
