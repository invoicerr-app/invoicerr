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
 * ROUND-TRIP PROVEN 2026-09-24, and reproduced before this header was written: two independent runs
 * of THIS spec deposited for real and came back with `InboxItemID` 1117002 and 1117004. Delivery is
 * not inferred from the 200 either - the receiver ANSWERED. `GET /peppol/inbox` carries one IMR
 * (Peppol invoice message response) per deposit, `SenderPeppolID: 0208:0563846944` back to
 * `ReceiverPeppolID: 9957:FR54982187676`, which is this company. The deposit really left the
 * platform and really reached the far end of the Peppol test network.
 *
 * TWO THINGS THAT COST A DAY TO FIND, both recorded here so nobody pays for them twice:
 *
 *  1. THE SUPPLIER IN THE DOCUMENT MUST BE THE BILLIT COMPANY ITSELF - see the `seller` fixture's
 *     own comment below. A supplier Billit cannot match to the `partyID` header is refused with a
 *     generic HTTP 400 that names nothing at all. The same document with the right supplier is
 *     accepted. Billit's own `/orders` route reports the underlying reason properly where
 *     `/peppol/sendxml` does not, so when this spec fails opaquely, POST a throwaway order and read
 *     ITS message log: that is where the real sentence is.
 *  2. A FRENCH SELLER DATED ON OR AFTER 2026-09-01 CANNOT BE BUILT AT ALL - see the `issueDate`
 *     comment below. That is a limitation of THIS codebase (BT-23 landing in `cbc:ProfileID`), not
 *     of Billit, and it is why the date is pinned rather than `new Date()`.
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
    // THE SELLER MUST BE THE BILLIT COMPANY ITSELF. Billit resolves the sender of a
    // `/peppol/sendxml` deposit from the supplier carried IN the document and matches it against the
    // company the `partyID` header names; a supplier it cannot match that way is refused with a
    // generic, unhelpful HTTP 400. Proven the hard way on 2026-09-24: the identical document with a
    // fictional Belgian supplier was refused, and with THIS identity was accepted. So these values
    // are not decoration, they are the sandbox company's own registered identity
    // (`GET /party/<partyID>` answers `"VATNumber":"FR54982187676"`), and anyone running this spec
    // against a DIFFERENT Billit account has to put THEIR company here. Nothing here is a secret:
    // a VAT number is public by construction.
    const seller: DocumentFormatParty = {
      name: 'Invoicerr',
      address: '1 rue de la Facture',
      city: 'Lyon',
      postalCode: '69001',
      country: 'France',
      email: 'seller@example.fr',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'FR54982187676' },
        // BT-34, EAS 9957 (French VAT number) - the routing identity Billit sends under. Set
        // explicitly rather than left to `build-semantic-invoice.ts#endpointFor`'s own fallback,
        // which would derive a SIREN-shaped address this company has not registered.
        { scheme: 'PEPPOL_ENDPOINT', value: '9957:FR54982187676' },
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
        // PINNED, AND THE PIN IS THE POINT. The seller above is FRENCH, and France mandates BT-23
        // from 2026-09-01 (`content-requirements/data/fr.json`, CGI ann. II art. 242 nonies A I 8 bis).
        // `formats/semantic/business-process.ts` writes that French code into UBL's `cbc:ProfileID`,
        // which Peppol reserves for its OWN process URNs, so a French invoice dated on or after that
        // day is rejected by our own vendored Peppol delta before it ever reaches Billit:
        //   PEPPOL-EN16931-R007: Business process MUST be in the format
        //   'urn:fdc:peppol.eu:2017:poacc:billing:NN:1.0' ...
        // 2026-08-31 is ONE DAY before the mandate, so the temporal gate correctly resolves no code
        // and `@e-invoice-eu/core`'s own default (the Peppol URN) stands - the SAME "the gate refuses
        // to fire a day early" fact `pdp/pdp.live.spec.ts` already leans on, in the opposite
        // direction. This is a documented limitation of the CODEBASE, not of Billit, and it is NOT a
        // claim that a post-mandate French invoice can go out over Peppol today: it cannot, and the
        // live-testing guide says so in its own section. The day BT-23 gets a per-syntax home (the
        // way Chorus Pro already has `businessProcessCodeOverride`), unpin this.
        issueDate: '2026-08-31',
        dueDate: '2026-08-31',
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
