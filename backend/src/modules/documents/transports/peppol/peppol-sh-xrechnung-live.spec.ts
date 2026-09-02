/**
 * "Le trou allemand du B2G", live half — does peppol.sh's own sandbox accept and DELIVER an XRechnung
 * UBL document (not Peppol BIS)? Same exact motif as `peppol-sh-live.spec.ts` (self-signup → company,
 * FR→BE fallback with an explicit `peppol_id` → send → poll to a terminal status) — the ONLY delta is
 * the format built and sent: `formats/xrechnung-provider.ts` instead of `formats/peppol-bis-provider.
 * ts`, with a German seller carrying an IBAN (BR-DE-1) so the REAL vendored KoSIT delta actually
 * passes before this spec ever reaches the network — see `xrechnung-provider.spec.ts`'s own master
 * proof for the same fixture shape.
 *
 * THIS TASK'S OWN RUN, 2026-09-02 — RAW RESULT recorded here VERBATIM once obtained (never rounded up
 * to "it works" from a partial signal) — see `LIVE_TESTING.md` for the canonical write-up this file's
 * own header points back to.
 *
 * ## HONEST LIMIT OF WHAT THIS PROVES — read `peppol-sh-client.ts#ublToPeppolShDocument`'s own header
 * before over-reading a green run here
 *
 * peppol.sh's `POST /v1/documents` does NOT accept raw UBL bytes at all (JSON model only) — this
 * adapter EXTRACTS a handful of generic EN 16931 UBL fields (party name, tax id, currency, dates,
 * lines) from whatever UBL it is handed, and peppol.sh RE-SERIALIZES its own UBL server-side for
 * actual delivery. That extraction never reads `cbc:CustomizationID` or any XRechnung-specific
 * element (BuyerReference/Contact/PaymentMeans) at all — it is the exact SAME code path
 * `peppol-sh-live.spec.ts` already exercises for Peppol BIS. A DELIVERED outcome here is still a real,
 * meaningful proof (this codebase's OWN XRechnung artifact — the REAL vendored base + KoSIT delta,
 * already gated valid before this file ever sends anything — is structurally compatible with the SAME
 * generic UBL extraction path Peppol BIS already is: the extra BR-DE-* mandatory elements do not
 * break the naive walker), but it is NOT proof that peppol.sh's own sandbox receiver judges, keeps, or
 * forwards the document AS XRechnung specifically — their own re-serialized copy is a generic
 * peppol.sh-shaped document, not a byte-for-byte relay of what this codebase built. The genuinely
 * XRechnung-specific claim this task settles is judged LOCALLY, before this file ever sends anything:
 * `xrechnungFormatProvider.build()`'s own `validation.valid` gate (the real vendored KoSIT Schematron)
 * and the `cbc:CustomizationID` this spec asserts on the BUILT bytes below, prior to the network call.
 *
 * Gate: `PEPPOL_LIVE=1` AND `PEPPOL_AP_PROVIDER=peppol-sh` (same two env vars as the sibling spec —
 * deliberately not a third, separate flag: this is the SAME sandbox account/gate, a different format).
 */
import { liveDescribe } from '../live-gate';

const describeLive =
  process.env.PEPPOL_AP_PROVIDER === 'peppol-sh' ? liveDescribe('PEPPOL_LIVE', []) : describe.skip;

/** Same EAS table `peppol-sh-live.spec.ts` and `formats/semantic/build-semantic-invoice.ts` already
 *  carry — reused, not reinvented. */
const EAS_BY_COUNTRY: Record<string, string> = { FR: '9957', BE: '9925', DE: '9930' };

function syntheticVatFor(country: string): string {
  const digits = '999999999';
  return `${country.toUpperCase()}${digits}`;
}

/** ISO 13616's own published example IBAN (Deutsche Bundesbank) — checksum-valid, never a real
 *  account — the SAME fixture value `xrechnung-provider.spec.ts`'s own master proof already uses. */
const TEST_IBAN = 'DE89370400440532013000';

describeLive(
  'Peppol live round-trip via peppol.sh — XRechnung content over the Peppol channel (DE B2G)',
  () => {
    it('self-signup → company (FR→fallback-country retry) → XRechnung UBL (real KoSIT delta) → send → doc_ id → poll → delivered', async () => {
      const timestamp = Date.now();
      const buyerVat = 'FR12345678901';
      const firstCountry = (process.env.PEPPOL_SH_SUPPLIER_COUNTRY || 'FR').toUpperCase();
      const fallbackCountry = (process.env.PEPPOL_SH_FALLBACK_COUNTRY || 'BE').toUpperCase();

      const { PeppolShApClient } = await import('./peppol-sh-client');

      let apiKey = process.env.PEPPOL_SH_API_KEY;
      let apCompanyId = process.env.PEPPOL_SH_COMPANY_ID;
      let usedCountry = firstCountry;

      if (!apiKey) {
        const email = `invoicerr-live-xrechnung-${timestamp}@example.com`;
        const signup = await PeppolShApClient.signup(email, 'Invoicerr Live Test (XRechnung)');
        apiKey = signup.apiKey;
        apCompanyId = undefined;
        // eslint-disable-next-line no-console
        console.log(`peppol.sh self-signup OK: account ${signup.accountId} (${email})`);
      }

      async function tryCreateCompany(country: string): Promise<string> {
        const vat = syntheticVatFor(country);
        const eas = EAS_BY_COUNTRY[country];
        const peppolId = eas ? `${eas}:${vat}` : undefined;
        // eslint-disable-next-line no-console
        console.log(`peppol.sh creating company with country=${country} peppol_id=${peppolId ?? '(none)'}`);
        const created = await PeppolShApClient.createCompany(apiKey!, {
          name: 'Invoicerr Live Test Co (XRechnung)',
          taxId: vat,
          country,
          address: { street: '1 Test Street', city: 'Brussels', postal_code: '1000' },
          peppolId,
        });
        return created.companyId;
      }

      if (!apCompanyId) {
        try {
          apCompanyId = await tryCreateCompany(firstCountry);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes('invalid_country') || firstCountry === fallbackCountry) {
            throw error;
          }
          // eslint-disable-next-line no-console
          console.log(
            `peppol.sh REJECTED country=${firstCountry} with invalid_country — retrying with ` +
              `fallback country=${fallbackCountry}`,
          );
          usedCountry = fallbackCountry;
          apCompanyId = await tryCreateCompany(fallbackCountry);
        }
        // eslint-disable-next-line no-console
        console.log(`peppol.sh company created: ${apCompanyId} (country=${usedCountry})`);
      }
      expect(apiKey).toBeTruthy();
      expect(apCompanyId).toMatch(/^com_/);

      // ── Generate a REAL XRechnung UBL invoice — pure, DB-free. A German seller WITH an IBAN (BR-DE-1)
      // and a French buyer (VAT-routable on peppol.sh, same reasoning `peppol-sh-live.spec.ts` gives for
      // isolating peppol.sh's own behaviour from this codebase's own R002 gap — XRechnung has no such
      // gap, but keeping the SAME buyer keeps this a true single-variable delta against the sibling spec).
      const { buildInvoiceDescriptor } = await import('../../descriptors/invoice.descriptor');
      const { xrechnungFormatProvider } = await import('../../formats/xrechnung-provider');

      const descriptor = buildInvoiceDescriptor();
      const document = {
        id: 'live-doc-1',
        displayNumber: `INV-PEPPOLSH-XR-${timestamp}`,
        status: 'sent',
        data: {
          client: 'client-1',
          issueDate: new Date().toISOString().slice(0, 10),
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          currency: 'EUR',
          buyerReference: `04011000-${timestamp}-06`, // BT-10 — plausible Leitweg-ID SHAPE, never a real one.
          lines: [
            {
              description: 'peppol.sh live test service (XRechnung)',
              quantity: 1,
              unit: 'unit',
              unitPrice: 100,
              vatRate: '19',
            },
          ],
        },
      };
      const sellerVat = 'DE123456789';
      const seller = {
        name: 'Invoicerr Live Test GmbH',
        address: '1 Teststraße',
        city: 'Berlin',
        postalCode: '10115',
        country: 'DE',
        email: 'sender@example.com',
        phone: '+49301234567',
        iban: TEST_IBAN, // BR-DE-1/23-a/23-b — the ONE fact `peppol-sh-live.spec.ts`'s own DE seller lacks.
        partyIdentifiers: [{ scheme: 'VAT', value: sellerVat }],
      };
      const buyer = {
        name: 'Test Receiver SARL',
        address: '2 Rue du Destinataire',
        city: 'Paris',
        postalCode: '75001',
        country: 'FR',
        partyIdentifiers: [{ scheme: 'VAT', value: buyerVat }],
      };

      const build = await xrechnungFormatProvider.build(descriptor, document, seller, buyer);
      if (!build.validation.valid) {
        throw new Error(
          `XRechnung artifact failed validation before it could even be sent: ${build.validation.errors.join(' | ')}`,
        );
      }
      const xml = Buffer.from(build.bytes).toString('utf-8');
      // THE XRECHNUNG-SPECIFIC CLAIM, judged LOCALLY before the network is ever touched — see this
      // file's own header, "HONEST LIMIT OF WHAT THIS PROVES": the CustomizationID actually inside the
      // bytes this spec is about to send is XRechnung's, never Peppol BIS's.
      expect(xml).toContain('urn:xeinkauf.de:kosit:xrechnung_3.0');
      expect(xml).not.toContain('urn:fdc:peppol.eu:2017:poacc:billing:3.0');
      // eslint-disable-next-line no-console
      console.log('XRechnung UBL length:', build.bytes.length);

      // ── Send through the REAL peppol.sh sandbox ──
      const receiverId = process.env.PEPPOL_RECEIVER_ID;
      const client = new PeppolShApClient({
        apiKey,
        companyId: apCompanyId,
        environment: 'TEST',
      });

      const sendResult = await client.send({
        senderParticipantId: `${EAS_BY_COUNTRY.DE}:${sellerVat}`,
        receiverParticipantId: receiverId ?? '',
        documentTypeId:
          'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0::2.1',
        processId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
        documentBytes: build.bytes,
        idempotencyKey: document.displayNumber,
      });

      // eslint-disable-next-line no-console
      console.log('peppol.sh send result (XRechnung):', JSON.stringify(sendResult, null, 2));
      expect(sendResult.messageId).toBeTruthy();
      expect(sendResult.messageId).toMatch(/^doc_/);

      // ── Poll to a TERMINAL status (sandbox: queued → sending → delivered) ──
      const MAX_POLLS = 24;
      const POLL_INTERVAL_MS = 5_000;
      let status: Awaited<ReturnType<typeof client.getStatus>> | undefined;

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        status = await client.getStatus(sendResult.messageId);
        // eslint-disable-next-line no-console
        console.log(`Poll ${i + 1}/${MAX_POLLS}:`, JSON.stringify(status));
        if (status.status === 'DELIVERED' || status.status === 'FAILED') break;
      }

      // eslint-disable-next-line no-console
      console.log('Final peppol.sh status (XRechnung):', JSON.stringify(status, null, 2));

      if (status?.status === 'FAILED') {
        throw new Error(
          `peppol.sh delivery FAILED — hard failure. Details: ${status.mlrDescription ?? '(none)'}`,
        );
      }
      expect(status?.status).toBe('DELIVERED');
    }, 240_000);
  },
);
