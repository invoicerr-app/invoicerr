/**
 * REAL round-trip against ksef-test.mf.gov.pl. Gated the same way the
 * reference's own `ksef-live.spec.ts` was (`KSEF_LIVE=1` + `KSEF_AUTH_TOKEN` [+ `KSEF_NIP`] —
 * `../live-gate.ts`), run the same way:
 *
 *   cd backend && set -a; . .env.test.local; set +a
 *   KSEF_LIVE=1 KSEF_AUTH_TOKEN=<token> KSEF_NIP=<nip> npx jest ksef.live --no-coverage --runInBand
 *
 * `KSEF_AUTH_TOKEN`/`KSEF_NIP` DO exist as CI secrets today (confirmed by name via `gh secret list`,
 * 2026-09-14 — values never read here). They authenticated successfully against ksef-test.mf.gov.pl
 * as recently as 2026-07-14 (a CI run of the pre-refactor `compliance/providers/transmission/ksef/
 * ksef-live.spec.ts`: real submission, a semantic `REJECTED` — code 450 — not an auth failure). No CI
 * run of `compliance-live.yml` has happened since the 2026-08-29 refactor that produced THIS file, so
 * this exact suite has no run on record — whether the secret is still valid today is UNVERIFIED, not
 * proven expired. `liveDescribe` will actually RUN (not skip) if `KSEF_LIVE=1` is set — this file does
 * NOT invent a sandbox, a mock server, or a fabricated token to force a green run.
 *
 * DB-FREE ON PURPOSE, same choice `superpdp/superpdp.live.spec.ts` makes for the identical reason: this spec
 * calls `fa3FormatProvider.build()` directly (descriptor + plain party objects, no Prisma — unlike
 * `facturx-provider.ts`, FA(3) needs no companyId/PDF render step) rather than `ksef-transport.ts`'s
 * exported `send()` (which reads `Company`/`Client` rows).
 *
 * HARD-SUCCESS CONTRACT — REPRISED VERBATIM from the reference's own `ksef-live.spec.ts`: a REJECTED or
 * SKIPPED transmission result, or an empty/missing `ksefNumber`, is a FAILURE the assertions below
 * throw on — never a soft `expect().toBeFalsy()` that could quietly pass on a shrugging response.
 * Unlike `ksef-transport.ts`'s own contract (which stops at "session/invoice accepted" — see
 * that file's own header), THIS live spec polls all the way to CLEARED: it is the one place in this
 * codebase that proves the FULL round-trip, not just the upload.
 */
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { DocumentFormatParty } from '../../formats/format-provider';
import { fa3FormatProvider } from '../../formats/national/fa3-provider';
import { liveDescribe } from '../live-gate';
import { FetchKsefHttpClient } from './fetch-http-client';
import { KsefClient } from './ksef-client';
import { generateSessionKey } from './ksef-crypto';
import { loadVendorizedKeys } from './ksef-public-keys';

const describeLive = liveDescribe('KSEF_LIVE', ['KSEF_AUTH_TOKEN']);

const nip = process.env.KSEF_NIP ?? '5260001246'; // MF's own well-known TEST NIP, same fallback
// the reference's own live spec used.

const SELLER: DocumentFormatParty = {
  name: 'invoicerr live test seller',
  address: 'ul. Testowa 1',
  city: 'Warszawa',
  postalCode: '00-001',
  country: 'Poland',
  partyIdentifiers: [{ scheme: 'VAT', value: `PL${nip}` }],
};
const POLISH_BUYER: DocumentFormatParty = {
  name: 'invoicerr live test buyer',
  address: 'ul. Kupiecka 2',
  city: 'Kraków',
  postalCode: '31-010',
  country: 'Poland',
  partyIdentifiers: [{ scheme: 'VAT', value: 'PL9876543210' }],
};

// Issue #748: a business buyer established in another EU member state, with its VAT number. FA(3)
// identifies it by `KodUE` FR + `NrVatUE` sent WITHOUT its "FR" prefix (`fa3-provider.ts`, Podmiot2).
// XSD validity alone did not prove KSeF accepts that value; this case does.
const FRENCH_BUYER: DocumentFormatParty = {
  name: 'invoicerr live test buyer FR',
  address: '1 rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'France',
  partyIdentifiers: [{ scheme: 'VAT', value: 'FR40303265045' }],
};

/** Builds the FA(3) for `buyer`, submits it to ksef-test.mf.gov.pl and returns the CLEARED ksefNumber. */
async function submitAndClear(buyer: DocumentFormatParty): Promise<string> {
  const ksefToken = process.env.KSEF_AUTH_TOKEN ?? '';
  const timestamp = Date.now();
  const descriptor = buildInvoiceDescriptor();
  const document = {
    id: 'live-doc',
    data: {
      client: 'live-client',
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date().toISOString().slice(0, 10),
      currency: 'PLN',
      lines: [
        {
          description: 'Usługa testowa (item 10, wave 2)',
          quantity: 1,
          unit: 'szt.',
          unitPrice: 100,
          vatRate: '23',
        },
      ],
    },
    displayNumber: `INV-LIVE-${timestamp}`,
    status: 'sending',
    createdAt: new Date(),
  };

  // ── 1) FA(3), gated by the REAL vendored schemat_FA3.xsd (fa3-provider.ts's own build()). ──
  const buildResult = await fa3FormatProvider.build(descriptor, document, SELLER, buyer);
  if (!buildResult.validation.valid) {
    throw new Error(
      `fa3-provider's own XSD gate rejected the document: ${buildResult.validation.errors.join('; ')}`,
    );
  }
  const xmlContent = new TextDecoder('utf-8').decode(buildResult.bytes);
  console.log('FA(3) XML length:', xmlContent.length, '- XSD-valid:', buildResult.validation.valid);

  // ── 2) The REAL round-trip - the exact client ksef-transport.ts uses in production. ──
  const keys = loadVendorizedKeys('test');
  const http = new FetchKsefHttpClient();
  const client = new KsefClient(http, {
    environment: 'test',
    nip,
    ksefToken,
    tokenEncryptionKeyPem: keys.tokenEncryptionKeyPem,
    symmetricKeyPem: keys.symmetricKeyPem,
  });

  console.log('Authenticating against ksef-test.mf.gov.pl...');
  const challenge = await client.authChallenge();
  const authResponse = await client.authKsefToken(challenge.challenge, challenge.timestampMs);

  let authSuccess = false;
  for (let i = 0; i < 5; i++) {
    const authStatus = await client.authStatus(
      authResponse.referenceNumber,
      authResponse.authenticationToken.token,
    );
    if (authStatus.status.code === 200) {
      authSuccess = true;
      break;
    }
    if (authStatus.status.code >= 400) {
      throw new Error(
        `KSeF auth REJECTED (code ${authStatus.status.code}: ${authStatus.status.description}) - hard failure.`,
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!authSuccess) {
    throw new Error('KSeF auth did not complete (still "processing") within the poll budget - hard failure.');
  }
  const tokens = await client.authRedeem(authResponse.authenticationToken.token);
  console.log('Authenticated.');

  const sessionKey = generateSessionKey();
  const session = await client.openOnlineSession(tokens.accessToken.token, sessionKey);
  if (!session.referenceNumber) {
    throw new Error('KSeF returned no usable session reference - hard failure.');
  }
  console.log('Session opened:', session.referenceNumber);

  const invoiceResult = await client.sendInvoice(
    session.referenceNumber,
    tokens.accessToken.token,
    xmlContent,
    sessionKey,
  );
  if (!invoiceResult.referenceNumber) {
    throw new Error("KSeF returned no usable invoice reference - hard failure (mutation #2's own target).");
  }
  console.log('Invoice submitted:', invoiceResult.referenceNumber);
  expect(invoiceResult.referenceNumber).not.toBe('');

  await client.closeSession(session.referenceNumber, tokens.accessToken.token);
  console.log('Session closed - polling for CLEARED...');

  // ── 3) Poll to CLEARED - the FULL round-trip, not just the upload (see this file's own header). ──
  const MAX_POLLS = 15;
  const POLL_INTERVAL_MS = 3000;
  let finalStatus: Awaited<ReturnType<typeof client.invoiceStatus>> | undefined;

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    finalStatus = await client.invoiceStatus(
      session.referenceNumber,
      invoiceResult.referenceNumber,
      tokens.accessToken.token,
    );
    console.log(`Poll ${i + 1}/${MAX_POLLS}:`, finalStatus.status.code, finalStatus.status.description);
    if (finalStatus.status.code === 200 || finalStatus.status.code >= 400) break;
  }

  if (!finalStatus || finalStatus.status.code >= 400) {
    throw new Error(
      `KSeF REJECTED the invoice - hard failure. Final status: ${JSON.stringify(finalStatus?.status)}`,
    );
  }
  if (finalStatus.status.code !== 200) {
    throw new Error(
      `KSeF did not reach CLEARED within the poll budget - hard failure (never tolerated as a soft ` +
        `"still pending" pass). Final status: ${JSON.stringify(finalStatus.status)}`,
    );
  }
  if (!finalStatus.ksefNumber) {
    throw new Error('KSeF status is CLEARED (code 200) but carries no ksefNumber - hard failure.');
  }

  console.log('CLEARED - ksefNumber:', finalStatus.ksefNumber);
  return finalStatus.ksefNumber;
}

// Real KSeF number format: {NIP}-{YYYYMMDD}-{hex}-{checksum}.
const KSEF_NUMBER = /^\d{10}-\d{8}-[0-9A-F]+-[0-9A-F]{2}$/;

describeLive('KSeF live round-trip (ksef-test.mf.gov.pl) - FA(3) cleared with a real ksefNumber', () => {
  it('fa3-provider (real XSD gate) → real KSeF auth → real online session → CLEARED + ksefNumber', async () => {
    expect(await submitAndClear(POLISH_BUYER)).toMatch(KSEF_NUMBER);
  }, 120_000);

  it('#748: French buyer with a VAT number (KodUE FR + NrVatUE without prefix) → CLEARED + ksefNumber', async () => {
    const buildResult = await fa3FormatProvider.build(
      buildInvoiceDescriptor(),
      {
        id: 'live-doc-fr',
        data: {
          client: 'live-client-fr',
          issueDate: new Date().toISOString().slice(0, 10),
          dueDate: new Date().toISOString().slice(0, 10),
          currency: 'PLN',
          lines: [{ description: 'x', quantity: 1, unit: 'szt.', unitPrice: 1, vatRate: '23' }],
        },
        displayNumber: 'INV-LIVE-FR-SHAPE',
        status: 'sending',
      },
      SELLER,
      FRENCH_BUYER,
    );
    // Pin the exact shape KSeF is about to receive, so a green here proves THIS value was accepted.
    const xml = new TextDecoder('utf-8').decode(buildResult.bytes);
    expect(xml).toMatch(/<Podmiot2>[\s\S]*<KodUE>FR<\/KodUE>\s*<NrVatUE>40303265045<\/NrVatUE>/);
    expect(xml).not.toMatch(/<Podmiot2>[\s\S]*<NIP>[\s\S]*<\/Podmiot2>/);

    expect(await submitAndClear(FRENCH_BUYER)).toMatch(KSEF_NUMBER);
  }, 120_000);
});
