/**
 * Issue #472 - REAL round-trip of a CREDIT NOTE against the superpdp sandbox, the one platform with a
 * sandbox already wired up and credentials on hand locally. Same gate, same recipe and same parties as
 * `pdp.live.spec.ts` (see its own header for why this is DB-free and why a pdf-lib page stands in for
 * the human PDF); the only differences are the ones issue #472 adds: an invoice is deposited FIRST, then
 * a credit note correcting it - BT-3 381 and BG-3 (BT-25/BT-26) naming that invoice, exactly what
 * `formats/credit-note-source.ts` + `buildSemanticInvoice({ creditNote })` produce for a real linked
 * credit note.
 *
 *   cd backend && set -a; . .env.test.local; set +a
 *   PDP_LIVE=1 npx vitest run src/modules/documents/transports/pdp/pdp-credit-note.live.spec.ts
 *
 * HARD-SUCCESS CONTRACT, same as the invoice spec: an empty deposit id, or any event whose text reads as a
 * rejection, throws.
 */
import { PDFDocument } from 'pdf-lib';

import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { CorrectedInvoiceReference } from '../../formats/format-provider';
import { buildSemanticInvoice, SemanticPartyInput } from '../../formats/semantic/build-semantic-invoice';
import {
  applyFrenchBusinessProcess,
  applyFrenchBusinessProcessInObject,
  frenchBusinessProcessCode,
} from '../../formats/semantic/business-process';
import {
  splitCiiIncludedNotes,
  splitCiiIncludedNotesInObject,
} from '../../formats/semantic/cii-post-process';
import { newEuInvoiceService } from '../../formats/shared-build';
import { validateStructural } from '../../formats/structural-check';
import { EN16931_CII_SCH, validateSchematron } from '../../formats/vendored/validate-schematron';
import { computeDocumentTotals } from '../../totals/compute-totals';
import { liveDescribe } from '../live-gate';
import { PdpClient, SuperPdpInvoice } from './pdp-client';

const describeLive = liveDescribe('PDP_LIVE', ['PDP_BASE_URL', 'PDP_CLIENT_ID', 'PDP_CLIENT_SECRET']);

describeLive('PDP live round-trip (superpdp sandbox) - a credit note (381 + BG-3) after its invoice', () => {
  it('deposits an invoice, then a credit note correcting it; both reach a non-rejected fr:2xx verdict', async () => {
    const client = new PdpClient({
      baseUrl: process.env.PDP_BASE_URL ?? '',
      clientId: process.env.PDP_CLIENT_ID ?? '',
      clientSecret: process.env.PDP_CLIENT_SECRET ?? '',
      apiStyle: 'superpdp',
    });
    await client.authenticate();

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
        // BT-34 (Seller electronic address) - see `build-semantic-invoice.ts#explicitEndpointFor`'s
        // own header: the SAME `PEPPOL_ENDPOINT` identifier `company.settings.tsx` already collects,
        // now actually READ by the bridge. Without it, `endpointFor` falls back to the seller's own
        // SIREN as the routing address, which superpdp's sandbox annuaire does not recognise for this
        // tenant - found running THIS live spec for real (see pdp.live.spec.ts's own comment, no invented
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
        // BT-49 (Buyer electronic address) - same reasoning as the seller's own above; without it
        // superpdp refused the pre-check outright ("receiver address <0225:000000001> does not
        // accept this document").
        { scheme: 'PEPPOL_ENDPOINT', value: '0225:315143296_1421' },
      ],
    };

    const descriptor = buildInvoiceDescriptor();
    const today = new Date().toISOString().slice(0, 10);
    const timestamp = Date.now();
    const lines = [
      {
        description: 'Prestation de test (issue #472)',
        quantity: 1,
        unit: 'unit',
        unitPrice: 100,
        vatRate: '20',
        supplyType: 'SERVICES' as const,
      },
    ];
    const totals = computeDocumentTotals(descriptor, { issueDate: today, currency: 'EUR', lines });

    async function deposit(
      displayNumber: string,
      creditNote?: { correctedInvoice: CorrectedInvoiceReference },
    ) {
      const euInvoice = buildSemanticInvoice({
        displayNumber,
        issueDate: today,
        seller: SELLER,
        buyer: BUYER,
        lines: lines.map((l) => ({ ...l })),
        totals,
        creditNote,
      });
      // Same documented BT-23 bypass as `pdp.live.spec.ts` (see its own comment): the content
      // requirement's own temporal gate decides in production.
      const businessProcessCode =
        euInvoice['ubl:Invoice']['cbc:ProfileID'] ?? frenchBusinessProcessCode(['SERVICES']);
      euInvoice['ubl:Invoice']['cbc:ProfileID'] = businessProcessCode;

      const service = newEuInvoiceService();
      const cii = applyFrenchBusinessProcess(
        splitCiiIncludedNotes((await service.generate(euInvoice, { format: 'CII', lang: 'en' })) as string),
        businessProcessCode,
      );
      const structural = validateStructural(cii, 'cii');
      if (!structural.valid) throw new Error(`structural gate: ${structural.errors.join('; ')}`);
      const schematron = validateSchematron(cii, EN16931_CII_SCH);
      if (!schematron.valid) {
        throw new Error(
          `Schematron gate: ${schematron.errors.map((e) => `${e.id}: ${e.message}`).join('; ')}`,
        );
      }
      console.log(`${displayNumber}: TypeCode`, /<ram:TypeCode>(\d+)<\/ram:TypeCode>/.exec(cii)?.[1]);

      const hostPdf = await PDFDocument.create();
      hostPdf.addPage([595, 842]);
      const facturx = (await service.generate(euInvoice, {
        format: 'Factur-X-EN16931',
        pdf: {
          buffer: Buffer.from(await hostPdf.save()),
          filename: `${displayNumber}.pdf`,
          mimetype: 'application/pdf',
        },
        lang: 'en',
        postProcessor: async (data) => {
          const embedded = data as Record<string, unknown>;
          splitCiiIncludedNotesInObject(embedded);
          applyFrenchBusinessProcessInObject(embedded, businessProcessCode);
        },
      })) as Uint8Array;

      const sent = await client.sendInvoice(Buffer.from(facturx), { externalId: displayNumber });
      if (!sent || String(sent.id ?? '') === '') {
        throw new Error(`superpdp returned no deposit id for ${displayNumber}: ${JSON.stringify(sent)}`);
      }
      let refetched: SuperPdpInvoice = await client.getInvoice(Number(sent.id));
      for (let attempt = 0; attempt < 10; attempt++) {
        if ((refetched.events ?? []).some((e) => e.status_code?.startsWith('fr:2'))) break;
        await new Promise((r) => setTimeout(r, 500));
        refetched = await client.getInvoice(Number(sent.id));
      }
      console.log(
        `${displayNumber}: deposit id ${sent.id}, events:`,
        JSON.stringify(refetched.events, null, 2),
      );
      const events = refetched.events ?? [];
      const rejected = events.find((e) => /rejet|reject|ko\b/i.test(e.status_text ?? ''));
      if (rejected) throw new Error(`superpdp rejected ${displayNumber}: ${JSON.stringify(rejected)}`);
      expect(events.some((e) => e.status_code?.startsWith('fr:2'))).toBe(true);
      return sent;
    }

    const invoiceNumber = `INV-LIVE-472-${timestamp}`;
    await deposit(invoiceNumber);
    await deposit(`CN-LIVE-472-${timestamp}`, {
      correctedInvoice: { displayNumber: invoiceNumber, issueDate: today },
    });
  }, 90_000);
});
