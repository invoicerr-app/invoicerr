/**
 * Peppol live round-trip via peppol.sh — ZERO-SECRET self-signup (Ethereal pattern), REPRISED and
 * adapted from git tag `avant-refonte-documents`
 * (`compliance/providers/transmission/peppol/peppol-sh-live.spec.ts`, itself proven live on
 * 2026-07-11) to THIS architecture: no `PeppolTransmissionProvider`/`InvoiceRenderingService` exist
 * any more, so this spec calls the SAME two, DB-free building blocks `pdp.live.spec.ts` already
 * established the precedent for — `formats/peppol-bis-provider.ts#build` (pure: descriptor → totals →
 * semantic bridge → UBL → the REAL vendored base EN 16931 + Peppol BIS Schematron gate, no Prisma) and
 * `peppol/peppol-sh-client.ts` (REPRISED, this task's own file) directly, never through
 * `peppol-transport.ts` itself (which needs `Company`/`Client` DB rows this DB-free run never has).
 *
 * THIS TASK'S OWN RETRY, run 2026-09-02 — RAW RESULT, not a guess (see `LIVE_TESTING.md` for the full
 * write-up):
 *   1. Signup: WORKS (a real `acc_…` account + `ps_test_…` key every run).
 *   2. Company creation with `country: 'FR'`: STILL `HTTP 400 invalid_country` — the SAME failure
 *      `LIVE_TESTING.md` recorded on 2026-08-29. Not fixed.
 *   3. Company creation with `country: 'BE'`: initially ALSO failed, with a DIFFERENT, NEW error —
 *      `missing_peppol_id` ("peppol_id is required and must be a valid <scheme>:<value> Peppol
 *      participant identifier") — a stricter validation than the repère's own 2026-07-11 proof ever
 *      exercised (tax_id alone was enough back then). Once an explicit `peppol_id` is supplied
 *      (`createCompany`'s own new, optional field), BE creation SUCCEEDS (`com_…`).
 *   4. The invoice CONTENT below uses a German seller/French buyer (never a French seller) SPECIFICALLY
 *      so this retry tests peppol.sh's OWN sandbox, not this codebase's OWN already-documented
 *      PEPPOL-EN16931-R002 limitation (`peppol-bis-provider.ts`'s own header) — a first pass with the
 *      repère's own French-seller fixture tripped exactly that rule (R002 + R007, both from this
 *      codebase's own gate, BEFORE ever reaching the network) and would have masked whatever peppol.sh
 *      itself says.
 * `PEPPOL_SH_SUPPLIER_COUNTRY` defaults to 'FR' (retries the historically-broken case first) and
 * FALLS BACK to 'BE' automatically on an `invalid_country` response — see the retry logic below — so
 * a future re-run needs no env change to re-discover both facts in one pass.
 *
 * Gate: `PEPPOL_LIVE=1` AND `PEPPOL_AP_PROVIDER=peppol-sh`.
 *
 * Optional env:
 *   PEPPOL_SH_API_KEY / PEPPOL_SH_COMPANY_ID — reuse an existing sandbox account (skips signup AND
 *                                               the country retry logic below entirely)
 *   PEPPOL_RECEIVER_ID                        — explicit receiver peppol id (scheme:id); default
 *                                               exercises tax_id-based routing
 *   PEPPOL_SH_SUPPLIER_COUNTRY                — ISO country to try FIRST for the peppol.sh sending
 *                                               company (default 'FR')
 *   PEPPOL_SH_FALLBACK_COUNTRY                — ISO country to retry with on `invalid_country`
 *                                               (default 'BE' — the one this retry found working)
 *
 * HARD-SUCCESS CONTRACT (ksef-mock-tests-false-confidence): a REJECTED/SKIPPED/PENDING outcome fails
 * the test — the poll must reach a real terminal 'delivered', never merely "didn't error".
 */
import { liveDescribe } from '../live-gate';

const describeLive =
  process.env.PEPPOL_AP_PROVIDER === 'peppol-sh' ? liveDescribe('PEPPOL_LIVE', []) : describe.skip;

/** Same EAS table `formats/semantic/build-semantic-invoice.ts` already carries — reused, not
 *  reinvented, so a synthesized `peppol_id` never names a scheme number the rest of this codebase
 *  does not already recognize. */
const EAS_BY_COUNTRY: Record<string, string> = { FR: '9957', BE: '9925', DE: '9930' };

function syntheticVatFor(country: string): string {
  // Sandbox-only, structurally-shaped VAT numbers — never a real registered one.
  const digits = '999999999';
  return `${country.toUpperCase()}${digits}`;
}

describeLive('Peppol live round-trip via peppol.sh (zero-secret sandbox)', () => {
  it('self-signup → company (with FR→fallback-country retry) → Peppol BIS UBL → send → doc_ id → poll → delivered', async () => {
    const timestamp = Date.now();
    const buyerVat = 'FR12345678901';
    const firstCountry = (process.env.PEPPOL_SH_SUPPLIER_COUNTRY || 'FR').toUpperCase();
    const fallbackCountry = (process.env.PEPPOL_SH_FALLBACK_COUNTRY || 'BE').toUpperCase();

    // ── Bootstrap: reuse env credentials or self-signup on the sandbox ──
    const { PeppolShApClient } = await import('./peppol-sh-client');

    let apiKey = process.env.PEPPOL_SH_API_KEY;
    let apCompanyId = process.env.PEPPOL_SH_COMPANY_ID;
    let usedCountry = firstCountry;

    if (!apiKey) {
      const email = `invoicerr-live-${timestamp}@example.com`;
      const signup = await PeppolShApClient.signup(email, 'Invoicerr Live Test');
      apiKey = signup.apiKey;
      apCompanyId = undefined; // fresh account → fresh company
      // eslint-disable-next-line no-console
      console.log(`peppol.sh self-signup OK: account ${signup.accountId} (${email})`);
      // The API key itself is never logged.
    }

    async function tryCreateCompany(country: string): Promise<string> {
      const vat = syntheticVatFor(country);
      const eas = EAS_BY_COUNTRY[country];
      const peppolId = eas ? `${eas}:${vat}` : undefined;
      // eslint-disable-next-line no-console
      console.log(`peppol.sh creating company with country=${country} peppol_id=${peppolId ?? '(none)'}`);
      const created = await PeppolShApClient.createCompany(apiKey!, {
        name: 'Invoicerr Live Test Co',
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
          throw error; // a DIFFERENT failure — never silently swallowed into the fallback path
        }
        // eslint-disable-next-line no-console
        console.log(
          `peppol.sh REJECTED country=${firstCountry} with invalid_country (same failure as ` +
            `LIVE_TESTING.md's own 2026-08-29 note) — retrying with fallback country=${fallbackCountry}`,
        );
        usedCountry = fallbackCountry;
        apCompanyId = await tryCreateCompany(fallbackCountry);
      }
      // eslint-disable-next-line no-console
      console.log(`peppol.sh company created: ${apCompanyId} (country=${usedCountry})`);
    }
    expect(apiKey).toBeTruthy();
    expect(apCompanyId).toMatch(/^com_/);

    // ── Generate a REAL Peppol BIS UBL invoice — pure, DB-free (same discipline as pdp.live.spec.ts).
    // A GERMAN seller ON PURPOSE (never French) — see this file's own header, point 4: isolates
    // peppol.sh's own behaviour from this codebase's own already-documented PEPPOL-EN16931-R002 gap.
    const { buildInvoiceDescriptor } = await import('../../descriptors/invoice.descriptor');
    const { peppolBisFormatProvider } = await import('../../formats/peppol-bis-provider');

    const descriptor = buildInvoiceDescriptor();
    const document = {
      id: 'live-doc-1',
      displayNumber: `INV-PEPPOLSH-${timestamp}`,
      status: 'sent',
      data: {
        client: 'client-1',
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        currency: 'EUR',
        buyerReference: `PO-${timestamp}`,
        lines: [
          {
            description: 'peppol.sh live test service',
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

    const build = await peppolBisFormatProvider.build(descriptor, document, seller, buyer);
    if (!build.validation.valid) {
      throw new Error(
        `Peppol BIS artifact failed validation before it could even be sent: ${build.validation.errors.join(' | ')}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log('Peppol BIS UBL length:', build.bytes.length);

    // ── Send through the REAL peppol.sh sandbox ──
    const receiverId = process.env.PEPPOL_RECEIVER_ID; // optional; default = tax_id routing
    const client = new PeppolShApClient({
      apiKey,
      companyId: apCompanyId,
      environment: 'TEST',
    });

    const sendResult = await client.send({
      senderParticipantId: `${EAS_BY_COUNTRY.DE}:${sellerVat}`,
      receiverParticipantId: receiverId ?? '',
      documentTypeId: 'urn:peppol-bis-invoice-3',
      processId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
      documentBytes: build.bytes,
      idempotencyKey: document.displayNumber,
    });

    // eslint-disable-next-line no-console
    console.log('peppol.sh send result:', JSON.stringify(sendResult, null, 2));
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
    console.log('Final peppol.sh status:', JSON.stringify(status, null, 2));

    if (status?.status === 'FAILED') {
      throw new Error(
        `peppol.sh delivery FAILED — hard failure. Details: ${status.mlrDescription ?? '(none)'}`,
      );
    }
    // Terminal success REQUIRED: DELIVERED. PENDING/QUEUED/SENT is a failure — see this file's own
    // hard-success contract.
    expect(status?.status).toBe('DELIVERED');
  }, 240_000);
});
