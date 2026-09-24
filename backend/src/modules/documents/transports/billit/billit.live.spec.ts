/**
 * REAL round-trip against the Billit sandbox. Gated exactly like every other live spec in this
 * directory (`live-gate.ts`): it runs only when `BILLIT_LIVE=1` AND all three credential variables
 * are set, so CI stays green without them.
 *
 *   cd backend && set -a; . .env.billit.local; set +a
 *   BILLIT_LIVE=1 npx vitest run billit.live --no-file-parallelism
 *
 * DB-FREE ON PURPOSE, the same choice `pdp/pdp.live.spec.ts` already makes and for the same reason:
 * the command above never sets `DATABASE_URL`. This spec therefore does not call
 * `billit-transport.ts`'s `send()` (which reads `Company`/`Client` rows), it composes the exact same
 * DB-free building blocks that function composes, by hand:
 *
 *   buildInvoiceDescriptor
 *     -> peppolBisFormatProvider.build   (REAL - the real semantic bridge, the REAL vendored
 *                                         EN 16931 UBL Schematron AND the REAL Peppol BIS delta,
 *                                         both blocking; unlike Factur-X this provider needs no
 *                                         companyId and touches neither Prisma nor Puppeteer)
 *     -> BillitClient (REAL, `billit/billit-client.ts`) .getParticipantInformation() + .sendPeppolXml()
 *
 * Nothing is mocked. The single substitution `pdp.live.spec.ts` has to make (a stand-in PDF, because
 * Factur-X embeds one) does not exist here at all: Billit's `/peppol/sendxml` takes the UBL itself,
 * so the artifact this spec deposits is byte-for-byte the artifact `billit-transport.ts` builds in
 * production.
 *
 * HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md): an EMPTY InboxItemID
 * is a FAILURE, never tolerated - this spec throws rather than assert a soft `expect().toBeFalsy()`
 * that could quietly pass on a shrugging response. A reference nobody can look up is not a reference
 * at all, which is the same rule `billit-transport.ts` enforces on the production path.
 *
 * WHY THE RECEIVER IS CHECKED FIRST: Billit refuses a deposit whose receiver is not registered on
 * the Peppol network for the document type being sent (`TheCustomerDoesNotSupportPeppolForType_0` -
 * https://docs.billit.be/docs/possible-errors), and the Peppol TEST network carries far fewer
 * participants than production. Asserting the registration in the same run means a future failure
 * says WHICH of the two facts stopped being true - the receiver disappearing from the test network,
 * or the deposit itself being refused - rather than leaving the next reader to guess. The receiver
 * is a public Peppol participant identifier, never a secret; `BILLIT_RECEIVER_ENDPOINT` overrides it
 * for anyone whose own sandbox has a better one.
 *
 * WHAT THIS SPEC DOES TODAY, STATED PLAINLY: it FAILS at step 3. Everything before the deposit was
 * run for real on 2026-09-24 and passed - both headers authenticate, the participant lookup answers,
 * and the document this repository builds clears Billit's OWN copy of the Peppol rules (proven by
 * feeding it a deliberately malformed Belgian enterprise number and getting
 * `[PEPPOL-COMMON-R043]` back by name, then getting past that stage once corrected). The deposit
 * itself is refused because the SANDBOX COMPANY RECORD carries no VAT number, which Billit states in
 * its own words on the order message log: "The VAT Number of your company () cannot be used to send
 * via Peppol, change your VAT number in your company record". Billit's OWN documented example
 * document is refused identically, which is how we know the refusal is the account and not this
 * repository's UBL. Setting that VAT number is a change to the Billit company record that only the
 * account owner can make (see the live-testing guide's Billit section). This spec is deliberately
 * NOT weakened to pass in the meantime: a live spec that goes green without a real deposit proves
 * nothing about the integration, which is exactly the false green this project keeps paying for.
 *
 * TRIAL EXPIRY: the sandbox account this runs against is a 14-day trial opened 2026-09-24, so it
 * stops being runnable on 2026-10-08 unless Billit extends it. See the live-testing guide.
 */
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { DocumentFormatParty } from '../../formats/format-provider';
import { peppolBisFormatProvider } from '../../formats/peppol-bis-provider';
import { liveDescribe } from '../live-gate';
import { BillitClient } from './billit-client';

const describeLive = liveDescribe('BILLIT_LIVE', ['BILLIT_API_BASE', 'BILLIT_API_KEY', 'BILLIT_PARTY_ID']);

/** A Belgian participant registered on the Peppol TEST network for `BISv3Invoice` - verified with
 *  Billit's own participant-information endpoint on 2026-09-24. Public routing data, not a
 *  credential. */
const DEFAULT_RECEIVER_ENDPOINT = '0208:0563846944';

describeLive('Billit live round-trip (sandbox) - Peppol BIS UBL deposit accepted', () => {
  it('peppolBisFormatProvider -> real EN16931 + Peppol Schematron gates -> real Billit deposit', async () => {
    const baseUrl = process.env.BILLIT_API_BASE ?? '';
    const apiKey = process.env.BILLIT_API_KEY ?? '';
    const partyId = process.env.BILLIT_PARTY_ID ?? '';
    const receiverEndpoint = process.env.BILLIT_RECEIVER_ENDPOINT || DEFAULT_RECEIVER_ENDPOINT;
    const [receiverScheme, receiverId] = receiverEndpoint.split(':');

    const client = new BillitClient({ baseUrl, apiKey, partyId });

    // 1) The receiver really is reachable on the Peppol TEST network - see this file's own header.
    const participant = await client.getParticipantInformation(receiverEndpoint);
    console.log('Billit participant lookup:', {
      identifier: participant.identifier,
      registered: participant.registered,
      documentTypes: participant.documentTypes,
    });
    if (!participant.registered || !participant.documentTypes.includes('BISv3Invoice')) {
      throw new Error(
        `Receiver ${receiverEndpoint} is not registered on the Peppol test network for BISv3Invoice - ` +
          `the deposit below could not succeed. Raw: ${JSON.stringify(participant.raw)}`,
      );
    }

    // 2) The document - the SAME provider `billit-transport.ts` uses in production.
    const timestamp = Date.now();
    const seller: DocumentFormatParty = {
      name: 'Invoicerr',
      address: 'Teststraat 31',
      city: 'Merchtem',
      postalCode: '1785',
      country: 'Belgium',
      email: 'seller@example.be',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'BE0437295992' },
        { scheme: 'LEGAL_ID', value: '0437295992' },
        { scheme: 'PEPPOL_ENDPOINT', value: '0208:0437295992' },
      ],
    };
    const buyer: DocumentFormatParty = {
      name: 'Billit Peppol test receiver',
      address: 'Oktrooiplein 1',
      city: 'Gent',
      postalCode: '9000',
      country: 'Belgium',
      email: 'buyer@example.be',
      partyIdentifiers: [{ scheme: 'PEPPOL_ENDPOINT', value: receiverEndpoint }],
    };

    const descriptor = buildInvoiceDescriptor();
    const document = {
      id: `live-${timestamp}`,
      displayNumber: `INV-BILLIT-${timestamp}`,
      status: 'sent',
      data: {
        client: 'live-client',
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date().toISOString().slice(0, 10),
        currency: 'EUR',
        // PEPPOL-EN16931-R003 - a buyer reference or a purchase order MUST be provided. `data.buyerReference`
        // is the key `formats/shared-build.ts#extractBuyerReference` reads generically, whatever
        // country-fields overlay (if any) put a screen control for it on this document.
        buyerReference: `PO-${timestamp}`,
        lines: [
          {
            description: 'Live integration test line',
            quantity: 1,
            unit: 'unit',
            unitPrice: 100,
            vatRate: '21',
          },
        ],
      },
    };

    const built = await peppolBisFormatProvider.build(descriptor, document, seller, buyer);
    if (!built.validation.valid) {
      throw new Error(`Peppol BIS gates rejected the document: ${built.validation.errors.join('; ')}`);
    }
    const xml = Buffer.from(built.bytes).toString('utf8');
    console.log('Peppol BIS UBL built and validated, bytes:', built.bytes.length);

    // 3) The REAL deposit.
    const result = await client.sendPeppolXml(xml);
    console.log('Billit /peppol/sendxml response:', JSON.stringify(result.raw));

    // HARD-SUCCESS CONTRACT - see this file's own header.
    if (!result.inboxItemId) {
      throw new Error(
        `Billit accepted the request but returned no InboxItemID - hard failure. Raw response: ` +
          JSON.stringify(result.raw),
      );
    }
    console.log(
      'DEPOSIT ACCEPTED - InboxItemID:',
      result.inboxItemId,
      'receiver:',
      receiverScheme,
      receiverId,
    );
    expect(result.inboxItemId).not.toBe('');
  }, 60_000);
});
