/**
 * REAL round-trip proof of `buildKsefStatusPoller` — gated the SAME way `transports/ksef/
 * ksef-live.spec.ts` already is (`KSEF_LIVE=1` + `KSEF_AUTH_TOKEN`, `live-gate.ts`), run the same way:
 *
 *   cd backend && set -a; . .env.test.local; set +a
 *   KSEF_LIVE=1 KSEF_AUTH_TOKEN=<token> KSEF_NIP=<nip> npx jest ksef-status-poller.live --no-coverage --runInBand
 *
 * **THESE CREDENTIALS ARE ABSENT TODAY** — same gap `transports/ksef/ksef-live.spec.ts`'s own header
 * already documents: no `KSEF_AUTH_TOKEN`/`KSEF_NIP` exist in this checkout or in CI secrets.
 * `liveDescribe` SKIPS this suite cleanly and says so on stderr — this file does not invent a token
 * or a fabricated response to force a green run.
 *
 * DB-FREE, same choice `ksef-live.spec.ts` itself makes: the submission recipe below is REPRISED from
 * that file (challenge → ksef-token → poll status → redeem → open session → send → CLOSE — the exact
 * sequence `ksef-transport.ts#send()` runs in production, including the close), not a copy of
 * production code (which needs a companyId to read real Company/Client rows via Prisma).
 *
 * Once real credentials exist, this spec's own job is TWO-FOLD, beyond what `ksef-live.spec.ts`
 * already proves (a real submission reaching CLEARED via `sessionStatus`):
 *  1. does `invoiceStatus` answer AT ALL for a session `ksef-transport.ts#send()` already CLOSED
 *     (see `ksef-status-poller.ts`'s own header, §2 — genuinely unknown today, which is why THIS spec
 *     closes the session before polling, deliberately mirroring production exactly)?
 *  2. does the `{ code, description, details }` convention this poller borrows from the AUTH status
 *     endpoint (`ksef-transport.ts#authenticate`) actually hold for THIS endpoint too?
 * Neither question can be answered without the credentials this checkout does not have — this file
 * exists so the FIRST session that gets them has a ready-to-run proof, not a blank page.
 */
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { DocumentFormatParty } from '../../formats/format-provider';
import { fa3FormatProvider } from '../../formats/national/fa3-provider';
import { liveDescribe } from '../../transports/live-gate';
import { FetchKsefHttpClient } from '../../transports/ksef/fetch-http-client';
import { KsefClient } from '../../transports/ksef/ksef-client';
import { generateSessionKey } from '../../transports/ksef/ksef-crypto';
import { loadVendorizedKeys } from '../../transports/ksef/ksef-public-keys';
import { buildKsefStatusPoller } from './ksef-status-poller';

const describeLive = liveDescribe('KSEF_LIVE', ['KSEF_AUTH_TOKEN']);

describeLive('KSeF conformity poller live round-trip (ksef-test.mf.gov.pl)', () => {
  it('submits (challenge→token→session→send→CLOSE, the exact production sequence), then polls via the REAL poller', async () => {
    const nip = process.env.KSEF_NIP ?? '5260001246';
    const ksefToken = process.env.KSEF_AUTH_TOKEN ?? '';

    const SELLER: DocumentFormatParty = {
      name: 'invoicerr live test seller',
      address: 'ul. Testowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'Poland',
      partyIdentifiers: [{ scheme: 'VAT', value: `PL${nip}` }],
    };
    const BUYER: DocumentFormatParty = {
      name: 'invoicerr live test buyer',
      address: 'ul. Kupiecka 2',
      city: 'Kraków',
      postalCode: '31-010',
      country: 'Poland',
      partyIdentifiers: [{ scheme: 'VAT', value: 'PL9876543210' }],
    };
    const document = {
      id: 'live-conformity-doc',
      data: {
        client: 'live-client',
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date().toISOString().slice(0, 10),
        currency: 'PLN',
        lines: [
          {
            description: 'Usługa testowa (conformity poller)',
            quantity: 1,
            unit: 'szt.',
            unitPrice: 100,
            vatRate: '23',
          },
        ],
      },
      displayNumber: `INV-LIVE-CONFORMITY-${Date.now()}`,
      status: 'sending',
      createdAt: new Date(),
    };

    const buildResult = await fa3FormatProvider.build(buildInvoiceDescriptor(), document, SELLER, BUYER);
    if (!buildResult.validation.valid) {
      throw new Error(
        `fa3-provider's own XSD gate rejected the document: ${buildResult.validation.errors.join('; ')}`,
      );
    }
    const xmlContent = new TextDecoder('utf-8').decode(buildResult.bytes);

    const keys = loadVendorizedKeys('test');
    const http = new FetchKsefHttpClient();
    const client = new KsefClient(http, {
      environment: 'test',
      nip,
      ksefToken,
      tokenEncryptionKeyPem: keys.tokenEncryptionKeyPem,
      symmetricKeyPem: keys.symmetricKeyPem,
    });

    const challenge = await client.authChallenge();
    const authResponse = await client.authKsefToken(challenge.challenge, challenge.timestampMs);
    let authSuccess = false;
    for (let i = 0; i < 5 && !authSuccess; i++) {
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
          `KSeF auth REJECTED (code ${authStatus.status.code}): ${authStatus.status.description}`,
        );
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!authSuccess) throw new Error('KSeF auth did not complete within the poll budget.');
    const tokens = await client.authRedeem(authResponse.authenticationToken.token);

    const sessionKey = generateSessionKey();
    const session = await client.openOnlineSession(tokens.accessToken.token, sessionKey);
    if (!session.referenceNumber) throw new Error('KSeF returned no usable session reference.');

    const invoiceResult = await client.sendInvoice(
      session.referenceNumber,
      tokens.accessToken.token,
      xmlContent,
      sessionKey,
    );
    if (!invoiceResult.referenceNumber) throw new Error('KSeF returned no usable invoice reference.');
    console.log('KSeF submission accepted:', session.referenceNumber, invoiceResult.referenceNumber);

    // CLOSE — deliberately, mirroring `ksef-transport.ts#send()` exactly (see this file's own header,
    // §1): whatever `invoiceStatus` answers below is the REAL answer to "does this still work once
    // production has already closed the session".
    await client.closeSession(session.referenceNumber, tokens.accessToken.token);

    const channelCredentials = {
      resolveActive: async () => ({
        providerId: 'ksef',
        channel: 'KSeF',
        environment: 'TEST' as const,
        isActive: true,
        config: { nip, ksefToken },
      }),
    } as never;
    const poller = buildKsefStatusPoller({ channelCredentials });
    const transportRef = `${session.referenceNumber}|${invoiceResult.referenceNumber}`;

    const events = await poller.poll('live-company', transportRef);
    console.log('KSeF invoiceStatus events (REAL, live, POST-CLOSE):', JSON.stringify(events, null, 2));
    expect(events.length).toBeGreaterThan(0);
  }, 60_000);
});
