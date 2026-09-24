/**
 * REAL round-trip against the Iopole sandbox (`api.ppd.iopole.fr`). Gated exactly the way
 * `pdp/pdp.live.spec.ts` is (`live-gate.ts`: an explicit flag AND every credential var present), and
 * run the same way:
 *
 *   cd backend && set -a; . /path/to/pdp-sandbox.env; set +a
 *   IOPOLE_LIVE=1 npx vitest run src/modules/documents/transports/iopole/iopole.live.spec.ts
 *
 * DB-FREE ON PURPOSE, the same choice `pdp.live.spec.ts` makes and for the same reason: that command
 * never sets `DATABASE_URL`, so this spec never touches Prisma. It does not call
 * `iopole-transport.ts`'s exported `send()` (which reads `Company`/`Client` rows); it calls the SAME
 * DB-free building blocks that function composes, by hand:
 *
 *   buildInvoiceDescriptor + computeDocumentTotals  (pure)
 *        → buildSemanticInvoice                      (pure - the semantic bridge)
 *        → newEuInvoiceService().generate(..., 'CII') → splitCiiIncludedNotes → validateStructural +
 *          validateSchematron                         (the EXACT gate `facturx-provider.ts` runs)
 *        → newEuInvoiceService().generate(..., 'Factur-X-EN16931', { pdf: a real pdf-lib PDF })
 *        → IopoleClient (REAL, `iopole/iopole-client.ts`) .authenticate() + .sendInvoice()
 *
 * A minimal, valid PDF from `pdf-lib` stands in for the "human" PDF `rendering/render-instance-pdf.ts`
 * would produce - the ONLY piece of the real `send()` path this spec does not exercise, and the one
 * Puppeteer/DB-coupled leaf that has nothing to do with EN 16931 conformity (the embedded CII, not
 * the human-readable page, is what a platform's conformity check reads). Everything that DOES matter
 * - the semantic bridge, the vendored Schematron gate, the real Factur-X PDF/A-3 embedder, the real
 * HTTP round-trip - runs for REAL, unmocked, against the real sandbox.
 *
 * THE TWO PARTIES ARE NOT INVENTED. They are two of the four business entities this project's own
 * sandbox account actually has registered on the DOMESTIC_FR network, read from the platform on
 * 2026-09-24 (`GET /v1/config/business/entity`): AIGLE TRANSPORT (SIREN 789275732) and BARKOCZY
 * (SIREN 841480502), whose directory addresses are `0225:789275732` and `0225:841480502`. Neither
 * party carries an explicit `PEPPOL_ENDPOINT` identifier here, deliberately: with a French `LEGAL_ID`
 * on file, `build-semantic-invoice.ts#endpointFor` already derives exactly `0225:<SIREN>`, which is
 * byte-for-byte what the sandbox directory registered - an explicit override would only be a second
 * copy of the same fact, free to drift. The VAT numbers are COMPUTED from those SIRENs, never made
 * up: key = (12 + 3 × SIREN mod 97) mod 97.
 *
 * HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md): an EMPTY invoice id is
 * a FAILURE, and so is an id the platform itself cannot resolve. This spec therefore does not stop
 * at the 201 - it reads the deposit back through `GET /v1/invoice/{id}` and asserts the platform
 * echoes the SAME id. "Accepted" that nobody can look up afterwards is not a reference at all.
 *
 * THE VERDICT IS ASSERTED, and only because it was reproduced first. Iopole's pipeline is
 * asynchronous: reading the status history in the same breath as the 201 genuinely returns `[]` -
 * that is what the first run of this spec measured. Half a second later the verdict is there, and it
 * was the SAME on two independent deposits (2026-09-24): SUBMITTED (destType PPF and OPERATOR) →
 * ISSUED → RECEIVED (networkCode 202) → MADE_AVAILABLE (networkCode 203), no rejection. So the block
 * at the end of this test polls for the history rather than sleeping a fixed time, then asserts a
 * real positive outcome - never a transient state, never "it was accepted so it must be fine". A
 * REJECTED / UNACCEPTABLE / REFUSED code anywhere in the history fails this test outright. That
 * discipline, and the reason for it, is `pdp.live.spec.ts`'s own header: this repository has paid
 * twice for a live test that asserted something which had not happened yet.
 */
import { PDFDocument } from 'pdf-lib';

import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { buildSemanticInvoice, SemanticPartyInput } from '../../formats/semantic/build-semantic-invoice';
import {
  applyFrenchBusinessProcess,
  applyFrenchBusinessProcessInObject,
} from '../../formats/semantic/business-process';
import {
  splitCiiIncludedNotes,
  splitCiiIncludedNotesInObject,
} from '../../formats/semantic/cii-post-process';
import { newEuInvoiceService } from '../../formats/shared-build';
import { validateStructural } from '../../formats/structural-check';
import { EN16931_CII_SCH, validateSchematron } from '../../formats/vendored/validate-schematron';
import { computeDocumentTotals } from '../../totals/compute-totals';
import { IOPOLE_URLS } from '../iopole-transport';
import { liveDescribe } from '../live-gate';
import { IopoleClient } from './iopole-client';

// The three credential vars are what the gate REQUIRES; the two URL vars below are optional
// overrides, because the hosts are already fixed constants in `iopole-transport.ts#IOPOLE_URLS` and
// an operator running this spec should not have to restate them.
const describeLive = liveDescribe('IOPOLE_LIVE', [
  'PDP_IOPOLE_CLIENT_ID',
  'PDP_IOPOLE_CLIENT_SECRET',
  'PDP_IOPOLE_CUSTOMER_ID',
]);

/** Iopole's own status vocabulary for "this did not go through" - see
 *  `iopole-client.ts#IopoleInvoiceStatus`. Either one present in the history is a real rejection and
 *  must fail this test, the same discipline `pdp.live.spec.ts` holds for its own `fr:213`. */
const IOPOLE_REJECTION_CODES = new Set(['REJECTED', 'UNACCEPTABLE', 'REFUSED']);

/** The positive codes that mean the platform has actually decided something about this deposit, as
 *  opposed to SUBMITTED, which only means the request arrived. See the retry loop below on why the
 *  difference is load-bearing here and not a nuance. */
const IOPOLE_TERMINAL_POSITIVE_CODES = new Set(['ISSUED', 'RECEIVED', 'MADE_AVAILABLE']);

describeLive('Iopole live round-trip (ppd sandbox) - Factur-X deposit accepted', () => {
  it('buildEuInvoice → real EN16931 Schematron gate → real Factur-X embed → real Iopole deposit', async () => {
    const clientId = process.env.PDP_IOPOLE_CLIENT_ID ?? '';
    const clientSecret = process.env.PDP_IOPOLE_CLIENT_SECRET ?? '';
    const customerId = process.env.PDP_IOPOLE_CUSTOMER_ID ?? '';
    const apiBaseUrl = process.env.PDP_IOPOLE_API_BASE || IOPOLE_URLS.sandbox.apiBaseUrl;
    const tokenUrl = process.env.PDP_IOPOLE_TOKEN_URL || IOPOLE_URLS.sandbox.tokenUrl;

    // Both entities are genuinely registered on this sandbox account - see this file's own header.
    const SELLER: SemanticPartyInput = {
      name: 'AIGLE TRANSPORT',
      address: '12 rue de la Sandbox',
      city: 'Lyon',
      postalCode: '69002',
      country: 'France',
      email: 'seller@example.fr',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'FR75789275732' },
        { scheme: 'LEGAL_ID', value: '789275732' },
      ],
    };
    const BUYER: SemanticPartyInput = {
      name: 'BARKOCZY',
      address: '3 avenue du Bac a Sable',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      email: 'buyer@example.fr',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'FR28841480502' },
        { scheme: 'LEGAL_ID', value: '841480502' },
      ],
    };

    const descriptor = buildInvoiceDescriptor();
    const timestamp = Date.now();
    const data = {
      client: 'live-client',
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date().toISOString().slice(0, 10),
      currency: 'EUR',
      lines: [
        {
          description: 'Prestation de test (Iopole sandbox)',
          quantity: 1,
          unit: 'unit',
          unitPrice: 100,
          vatRate: '20',
          supplyType: 'SERVICES' as const,
        },
      ],
    };
    const totals = computeDocumentTotals(descriptor, data);

    const euInvoice = buildSemanticInvoice({
      displayNumber: `IOPOLE-LIVE-${timestamp}`,
      issueDate: data.issueDate,
      seller: SELLER,
      buyer: BUYER,
      lines: data.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        supplyType: l.supplyType,
      })),
      totals,
    });

    // BT-23 through the REAL temporal gate - no bypass here, unlike `pdp.live.spec.ts`, which needed
    // one only because it ran a day before `content-requirements/data/fr.json`'s own `mandatedFrom`
    // (2026-09-01). This spec's `issueDate` is today, well past it, so whatever the gate resolves is
    // what goes out: the production behaviour, unmodified.
    const businessProcessCode = euInvoice['ubl:Invoice']['cbc:ProfileID'];
    console.log('BT-23 resolved by the real temporal gate:', businessProcessCode);

    const service = newEuInvoiceService();

    // 1) The plain CII, gated exactly like `cii-provider.ts`/`facturx-provider.ts`.
    const rawCii = (await service.generate(euInvoice, { format: 'CII', lang: 'en' })) as string;
    let cii = splitCiiIncludedNotes(rawCii);
    if (businessProcessCode) cii = applyFrenchBusinessProcess(cii, businessProcessCode);
    const structural = validateStructural(cii, 'cii');
    if (!structural.valid) {
      throw new Error(`structural gate rejected the CII: ${structural.errors.join('; ')}`);
    }
    const schematron = validateSchematron(cii, EN16931_CII_SCH);
    if (!schematron.valid) {
      throw new Error(
        'EN 16931 Schematron gate rejected the CII: ' +
          schematron.errors.map((e) => `${e.id}: ${e.message}`).join('; '),
      );
    }

    // 2) Embed into a REAL Factur-X PDF/A-3 - same recipe `facturx-provider.ts` runs, including the
    // `postProcessor` chain (see `pdp.live.spec.ts`'s own header for why both steps are required).
    const hostPdf = await PDFDocument.create();
    hostPdf.addPage([595, 842]); // A4
    const hostPdfBytes = Buffer.from(await hostPdf.save());

    const facturxPdf = (await service.generate(euInvoice, {
      format: 'Factur-X-EN16931',
      pdf: {
        buffer: hostPdfBytes,
        filename: `IOPOLE-LIVE-${timestamp}.pdf`,
        mimetype: 'application/pdf',
      },
      lang: 'en',
      postProcessor: async (embedded) => {
        const embeddedCii = embedded as Record<string, unknown>;
        splitCiiIncludedNotesInObject(embeddedCii);
        if (businessProcessCode) applyFrenchBusinessProcessInObject(embeddedCii, businessProcessCode);
      },
    })) as Uint8Array;
    expect(Buffer.from(facturxPdf.slice(0, 5)).toString()).toBe('%PDF-');
    console.log('Factur-X PDF built, bytes:', facturxPdf.length);

    // 3) The REAL round-trip - the exact client `iopole-transport.ts` uses in production.
    const client = new IopoleClient({ apiBaseUrl, tokenUrl, clientId, clientSecret, customerId });
    await client.authenticate();
    console.log('Authenticated against', tokenUrl);

    const created = await client.sendInvoice(Buffer.from(facturxPdf), {
      mime: 'application/pdf',
      fileName: `IOPOLE-LIVE-${timestamp}.pdf`,
    });
    console.log('Iopole POST /v1/invoice response:', JSON.stringify(created));

    // HARD-SUCCESS CONTRACT - an empty/missing id throws here rather than a soft `expect` that could
    // quietly pass on a shrugging response.
    if (!created || String(created.id ?? '') === '') {
      throw new Error(
        `Iopole did not return a usable invoice id - hard failure. Raw response: ${JSON.stringify(created)}`,
      );
    }
    expect(created.type).toBe('INVOICE');
    console.log('DEPOSIT ACCEPTED - invoice id:', created.id);

    // 4) The id must be one the PLATFORM itself can resolve, not merely something it echoed back.
    const metadata = await client.getInvoice(created.id);
    console.log('Iopole GET /v1/invoice/{id} response:', JSON.stringify(metadata));
    expect(String(metadata?.invoiceId ?? '')).toBe(String(created.id));

    // 5) The platform's own verdict. A SHORT RETRY LOOP, never a fixed sleep: the deposit is
    // asynchronous, and reading the history in the same breath as the 201 genuinely returns `[]` -
    // measured, that is exactly what the first run of this spec did.
    //
    // THE LOOP WAITS FOR A VERDICT, NOT MERELY FOR A NON-EMPTY HISTORY - a distinction this spec
    // paid for on its second run: SUBMITTED lands ~0.4s after the 201 and the rest ~0.2s later, so a
    // loop that stopped at "the history is no longer empty" read only SUBMITTED, which says the
    // request went out and nothing about whether it was accepted. Asserting a transient state is the
    // FIRST of the two false greens `pdp.live.spec.ts`'s own header records, reproduced here
    // verbatim before it was fixed. Polling every 500ms for up to 15s is ample margin for a verdict
    // that has landed in well under a second on every deposit measured.
    const isVerdict = (entries: typeof history) =>
      entries.some(
        (entry) =>
          IOPOLE_TERMINAL_POSITIVE_CODES.has(entry.status?.code ?? '') ||
          IOPOLE_REJECTION_CODES.has(entry.status?.code ?? ''),
      );
    let history = await client.getStatusHistory(created.id);
    for (let attempt = 0; attempt < 30 && !isVerdict(history); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      history = await client.getStatusHistory(created.id);
    }
    // `xml`/`json` are stripped from the log: each entry carries the FULL status document, which
    // makes the useful part (the code, the date, the destination) unreadable in a test log.
    console.log(
      'Iopole status history:',
      JSON.stringify(history.map(({ xml: _xml, json: _json, ...rest }) => rest)),
    );

    const codes = new Set(history.map((entry) => entry.status?.code ?? ''));
    const rejected = history.find((entry) => IOPOLE_REJECTION_CODES.has(entry.status?.code ?? ''));
    if (rejected) {
      throw new Error(`Iopole reported a rejection: ${JSON.stringify(rejected)}`);
    }
    // ASSERTED, not merely logged - and asserted only because it was REPRODUCED across two
    // independent live deposits before this line was written (2026-09-24, invoice ids
    // 01a0d285-f428-… and 01a0d286-6ec2-…): both produced the SAME full positive lifecycle within
    // ~0.6s of the 201 - SUBMITTED (destType PPF and OPERATOR) → ISSUED → RECEIVED (networkCode 202)
    // → MADE_AVAILABLE (networkCode 203), with no rejection anywhere. This is a real conformity
    // verdict, not an accepted upload. Kept deliberately narrow: at least ONE terminal-positive code,
    // never "exactly these five in this order", which would turn a harmless extra platform event
    // into a red test.
    expect(codes.has('SUBMITTED')).toBe(true);
    expect([...IOPOLE_TERMINAL_POSITIVE_CODES].some((code) => codes.has(code))).toBe(true);
  }, 120_000);
});
