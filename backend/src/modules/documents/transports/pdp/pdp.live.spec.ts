/**
 * REAL round-trip against the superpdp sandbox — root TODO item 10, wave 1. Gated the same way the
 * repère's own `pdp-live.spec.ts` was (`PDP_LIVE=1` + credential env vars — `live-gate.ts`, REPRISED
 * verbatim), and run the same way:
 *
 *   cd backend && set -a; . .env.test.local; set +a
 *   PDP_LIVE=1 npx jest pdp-live --no-coverage --runInBand
 *
 * DB-FREE ON PURPOSE, same choice the repère's own spec made (see its own "(DB-free)" comment): that
 * exact command above never sets DATABASE_URL, so this spec never touches Prisma — it does not call
 * `pdp-transport.ts`'s exported `send()` (which reads `Company`/`Client` rows), it calls the SAME
 * underlying, DB-free building blocks that function composes, by hand:
 *
 *   buildInvoiceDescriptor + computeDocumentTotals  (pure — descriptor → totals, no DB)
 *        → buildSemanticInvoice                      (pure — the semantic bridge, `shared-build.ts`'s
 *                                                       own dependency, no DB)
 *        → newEuInvoiceService().generate(..., 'CII') → splitCiiIncludedNotes → validateStructural +
 *          validateSchematron                         (the EXACT gate `facturx-provider.ts` runs —
 *                                                       ported here rather than imported, since that
 *                                                       provider's own `build()` needs a companyId to
 *                                                       call `renderDocumentInstance`, which DOES hit
 *                                                       Prisma + Puppeteer — see its own header)
 *        → newEuInvoiceService().generate(..., 'Factur-X-EN16931', { pdf: <a real, pdf-lib-built PDF> })
 *        → PdpClient (REAL, `pdp/pdp-client.ts`) .authenticate() + .sendInvoice()
 *
 * A minimal, valid PDF from `pdf-lib` stands in for the "human" PDF `rendering/render-instance-pdf.ts`
 * would normally produce — the ONLY piece of the real send() path this spec does not exercise, and
 * the one Puppeteer/DB-coupled leaf that has nothing to do with EN 16931 conformity (the embedded
 * CII, not the human-readable page, is what superpdp's own conformity check reads). Everything that
 * DOES matter to conformity — the semantic bridge, the vendored Schematron gate, the actual Factur-X
 * PDF/A-3 embedder, the actual HTTP round-trip — runs for REAL, unmocked, against the real sandbox.
 *
 * HARD-SUCCESS CONTRACT (LIVE_TESTING.md, and this task's own instructions): a REJECTED/SKIPPED
 * outcome or an EMPTY deposit id is a FAILURE, never tolerated — this spec throws rather than assert
 * a soft `expect().toBeFalsy()` that could quietly pass on a shrugging response. Wave 1's own
 * contract stops at "the deposit was ACCEPTED" (a non-empty id back from `POST /v1.beta/invoices`):
 * following the conformity verdict through fr:201/202 is a POLLER this wave does not build — see
 * `pdp-transport.ts`'s own header and TODO_ISSUES.md for that named remainder. This spec does NOT
 * claim more than that: it does not poll, and it does not assert a terminal status — the lesson paid
 * for once already (a poll that can only ever answer PENDING is a false green) applies just as much
 * to NOT building one and pretending its absence proves nothing is missing.
 */
import { PDFDocument } from 'pdf-lib';

import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { buildSemanticInvoice, SemanticPartyInput } from '../../formats/semantic/build-semantic-invoice';
import {
  splitCiiIncludedNotes,
  splitCiiIncludedNotesInObject,
} from '../../formats/semantic/cii-post-process';
import { newEuInvoiceService } from '../../formats/shared-build';
import { validateStructural } from '../../formats/structural-check';
import { EN16931_CII_SCH, validateSchematron } from '../../formats/vendored/validate-schematron';
import { computeDocumentTotals } from '../../totals/compute-totals';
import { liveDescribe } from '../live-gate';
import { PdpClient } from './pdp-client';

const describeLive = liveDescribe('PDP_LIVE', ['PDP_BASE_URL', 'PDP_CLIENT_ID', 'PDP_CLIENT_SECRET']);

describeLive('PDP live round-trip (superpdp sandbox) — Factur-X deposit accepted', () => {
  it('buildEuInvoice → real EN16931 Schematron gate → real Factur-X embed → real superpdp deposit', async () => {
    const baseUrl = process.env.PDP_BASE_URL ?? '';
    const clientId = process.env.PDP_CLIENT_ID ?? '';
    const clientSecret = process.env.PDP_CLIENT_SECRET ?? '';

    // Same sandbox tenant the repère's own live spec identified the hard way (its own header
    // explains why: 315143296/415143296 — the numbers on the original brief — are refused by
    // superpdp for this OAuth client; 000000002/000000001 are what `GET /v1.beta/companies/me`
    // actually answers for these credentials). VAT keys are computed, not invented: clé = (12 + 3 ×
    // SIREN mod 97) mod 97 — FR18000000002 and FR15000000001 both satisfy it.
    const SELLER: SemanticPartyInput = {
      name: 'Burger Queen',
      address: '809 avenue du Languedoc',
      city: 'Millau',
      postalCode: '12100',
      country: 'France',
      email: 'seller@example.fr',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'FR18000000002' },
        { scheme: 'LEGAL_ID', value: '000000002' },
        // BT-34 (Seller electronic address) — see `build-semantic-invoice.ts#explicitEndpointFor`'s
        // own header: the SAME `PEPPOL_ENDPOINT` identifier `company.settings.tsx` already collects,
        // now actually READ by the bridge. Without it, `endpointFor` falls back to the seller's own
        // SIREN as the routing address, which superpdp's sandbox annuaire does not recognise for this
        // tenant — found running THIS live spec for real (see this file's own header, no invented
        // fixture data): its own routing convention is `{pdp_siren}_{account_id}`, not the SIREN.
        { scheme: 'PEPPOL_ENDPOINT', value: '0225:315143296_1422' },
      ],
    };
    const BUYER: SemanticPartyInput = {
      name: 'Tricatel',
      address: '1 rue de Tricatel',
      city: 'Paris',
      postalCode: '75001',
      country: 'France',
      email: 'buyer@example.fr',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'FR15000000001' },
        { scheme: 'LEGAL_ID', value: '000000001' },
        // BT-49 (Buyer electronic address) — same reasoning as the seller's own above; without it
        // superpdp refused the pre-check outright ("receiver address <0225:000000001> does not
        // accept this document").
        { scheme: 'PEPPOL_ENDPOINT', value: '0225:315143296_1421' },
      ],
    };

    const descriptor = buildInvoiceDescriptor();
    const timestamp = Date.now();
    const data = {
      client: 'live-client',
      issueDate: new Date().toISOString().slice(0, 10), // superpdp refuses a BT-2 later than today
      dueDate: new Date().toISOString().slice(0, 10),
      currency: 'EUR',
      lines: [
        {
          description: 'Prestation de test (item 10, wave 1)',
          quantity: 1,
          unit: 'unit',
          unitPrice: 100,
          vatRate: '20',
        },
      ],
    };
    const totals = computeDocumentTotals(descriptor, data);

    const euInvoice = buildSemanticInvoice({
      displayNumber: `INV-LIVE-${timestamp}`,
      issueDate: data.issueDate,
      seller: SELLER,
      buyer: BUYER,
      lines: data.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
      })),
      totals,
    });

    const service = newEuInvoiceService();

    // ── 1) The plain CII, gated exactly like `cii-provider.ts`/`facturx-provider.ts` ──
    const rawCii = (await service.generate(euInvoice, { format: 'CII', lang: 'en' })) as string;
    const cii = splitCiiIncludedNotes(rawCii);
    const structural = validateStructural(cii, 'cii');
    if (!structural.valid) {
      throw new Error(`structural gate rejected the CII: ${structural.errors.join('; ')}`);
    }
    const schematron = validateSchematron(cii, EN16931_CII_SCH);
    if (!schematron.valid) {
      throw new Error(
        `EN 16931 Schematron gate rejected the CII: ` +
          schematron.errors.map((e) => `${e.id}: ${e.message}`).join('; '),
      );
    }

    // ── 2) Embed into a REAL Factur-X PDF/A-3 — a minimal valid host PDF (pdf-lib), see this
    // file's own header for why this is the one DB/Puppeteer-coupled leaf this spec substitutes. ──
    const hostPdf = await PDFDocument.create();
    hostPdf.addPage([595, 842]); // A4
    const hostPdfBytes = Buffer.from(await hostPdf.save());

    const facturxPdf = (await service.generate(euInvoice, {
      format: 'Factur-X-EN16931',
      pdf: { buffer: hostPdfBytes, filename: `INV-LIVE-${timestamp}.pdf`, mimetype: 'application/pdf' },
      lang: 'en',
      // Mirrors `facturx-provider.ts`'s own embed call EXACTLY (this spec's whole point is to run
      // the real production recipe by hand — see this file's own header) — found NECESSARY by this
      // very spec, live, once root TODO item 15 ("mentions obligatoires") started emitting more than
      // one BG-1 note for a French seller: without it, superpdp's own conformity check rejects the
      // deposit (`fr:213`) citing every mention "absente", with "Element 'ram:Content' must occur
      // exactly 1 times" underneath — `splitCiiIncludedNotesInObject`'s own header has the full story.
      postProcessor: async (data) => splitCiiIncludedNotesInObject(data as Record<string, unknown>),
    })) as Uint8Array;
    expect(Buffer.from(facturxPdf.slice(0, 5)).toString()).toBe('%PDF-');
    console.log('Factur-X PDF built, bytes:', facturxPdf.length);

    // ── 3) The REAL round-trip — the exact client `pdp-transport.ts` uses in production. ──
    const client = new PdpClient({ baseUrl, clientId, clientSecret, apiStyle: 'superpdp' });
    await client.authenticate();
    console.log('Authenticated against', baseUrl);

    const invoice = await client.sendInvoice(Buffer.from(facturxPdf), {
      externalId: `INV-LIVE-${timestamp}`,
    });
    console.log('superpdp response:', JSON.stringify(invoice, null, 2));

    // HARD-SUCCESS CONTRACT — never tolerate an empty/missing id (see this file's own header): a
    // REJECTED/SKIPPED outcome or an empty deposit id throws here rather than a soft `expect` that
    // could quietly pass on a shrugging response.
    if (!invoice || String(invoice.id ?? '') === '') {
      throw new Error(
        `superpdp did not return a usable deposit id — hard failure. Raw response: ` +
          JSON.stringify(invoice),
      );
    }
    console.log('DEPOSIT ACCEPTED — id:', invoice.id);
    expect(String(invoice.id)).not.toBe('');

    // ── 4) INFORMATIONAL ONLY — a single, one-shot re-fetch, never a retry loop: this spec does
    // NOT poll (see this file's own header — following the conformity verdict through fr:201/202 is
    // wave 1's own named remainder, TODO_ISSUES.md). This single GET exists only so the report can
    // cite what actually happened next, honestly, rather than stopping at "uploaded" and leaving the
    // reader to wonder. It is deliberately NOT a hard assertion either way: a `fr:2xx` verdict this
    // early is a REAL answer (proving this is not a poll that could only ever say PENDING — the
    // lesson paid for once already), whatever it says — wave 1's own contract is already satisfied
    // by the non-empty id above, before this block ever runs.
    await new Promise((r) => setTimeout(r, 2000));
    const refetched = await client.getInvoice(Number(invoice.id));
    const latestEvent = refetched.events?.[refetched.events.length - 1];
    console.log("Post-deposit conformity check (informational, not part of this wave's contract):", {
      status_code: latestEvent?.status_code,
      status_text: latestEvent?.status_text,
      reason: latestEvent?.data?.reason,
    });
  }, 60_000);
});
