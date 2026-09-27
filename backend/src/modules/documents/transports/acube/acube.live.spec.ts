/**
 * REAL round-trip against the A-Cube sandbox. Gated the same way every other live spec in this
 * directory is (`live-gate.ts`): it runs only when `ACUBE_LIVE=1` AND both credential env vars are
 * present, so CI stays green without them.
 *
 *   cd backend
 *   ACUBE_LIVE=1 PDP_ACUBE_EMAIL=<account e-mail> PDP_ACUBE_PASSWORD='<account password>' \
 *     npx vitest run acube.live --no-file-parallelism
 *
 * The env var names carry the `PDP_ACUBE_` prefix on purpose: that is verbatim how the operator's
 * own secrets file already stores them, and renaming them here would mean a hand-editing step
 * between reading that file and running this spec - exactly the kind of step that gets done wrong
 * once and then debugged as a phantom authentication bug. Quote the password in SINGLE quotes: it
 * legitimately contains `#`, which an unquoted shell assignment silently truncates at.
 *
 * DB-FREE ON PURPOSE, the same choice `pdp/pdp.live.spec.ts` makes and for the same reason: the
 * command above never sets `DATABASE_URL`, so this spec never touches Prisma. It does not call
 * `acube-transport.ts#send()` (which reads `Company`/`Client` rows); it calls the SAME building
 * blocks that function composes, by hand:
 *
 *   buildInvoiceDescriptor
 *        -> fatturapaFormatProvider.build(...)   (pure: descriptor + two parties -> FatturaPA XML,
 *                                                  gated by the REAL vendored Schema_VFPR12.xsd)
 *        -> AcubeClient (REAL, `acube/acube-client.ts`) .authenticate() + .sendInvoice()
 *        -> AcubeClient.getInvoice()             - the deposit read BACK off the platform
 *
 * Everything that matters to the integration runs for REAL, unmocked: the national XSD gate, the
 * password exchange, the actual HTTP deposit, and the read-back.
 *
 * HARD-SUCCESS CONTRACT (`documentation/docs/developer-guide/live-testing.md`): an empty or missing
 * uuid is a FAILURE, never tolerated - this spec throws rather than assert a soft
 * `expect().toBeFalsy()` that could quietly pass on a shrugging response. And the uuid is not merely
 * read out of the POST response: it is looked up AGAIN, against the platform, because a reference
 * nobody can look up is not a reference at all. That second step is what distinguishes this from the
 * class of false green this project has already been burned by twice (see the live-testing guide's
 * own "TWO false-greens" box).
 *
 * Deliberately NOT asserted: the SdI outcome. In the sandbox A-Cube does not forward anything to
 * SdI at all (their own documentation says so), so an assertion on a cleared/rejected verdict would
 * be asserting a state this environment can never reach. Following that verdict needs a poller -
 * see `acube-transport.ts`'s own header for that named remainder.
 */
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { fatturapaFormatProvider } from '../../formats/national/fatturapa-provider';
import { DocumentFormatParty } from '../../formats/format-provider';
import { liveDescribe } from '../live-gate';
import { AcubeClient } from './acube-client';

const describeLive = liveDescribe('ACUBE_LIVE', ['PDP_ACUBE_EMAIL', 'PDP_ACUBE_PASSWORD']);

/** Italian parties, the same fixture shape `fatturapa-provider.spec.ts` already uses. Nothing here
 *  has to pre-exist on A-Cube's side: unlike superpdp's annuaire, the sandbox accepted a deposit
 *  from a VAT number with no business-registry configuration at all (observed, 2026-09-24). */
const SELLER: DocumentFormatParty = {
  name: 'Rossi SRL',
  address: 'Via Roma 10',
  city: 'Milano',
  postalCode: '20100',
  country: 'Italy',
  partyIdentifiers: [
    { scheme: 'VAT', value: 'IT12345678901' },
    { scheme: 'LEGAL_ID', value: 'MI1234567' },
  ],
};

const BUYER: DocumentFormatParty = {
  name: 'Bianchi SpA',
  address: 'Corso Italia 20',
  city: 'Roma',
  postalCode: '00100',
  country: 'Italy',
  partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432109' }],
};

describeLive('A-Cube live round-trip (sandbox) - FatturaPA deposit accepted', () => {
  it('real XSD gate -> real password exchange -> real deposit -> the uuid read BACK off the platform', async () => {
    const email = process.env.PDP_ACUBE_EMAIL ?? '';
    const password = process.env.PDP_ACUBE_PASSWORD ?? '';
    const environment = process.env.PDP_ACUBE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';

    const timestamp = Date.now();
    // Kept short on purpose: FatturaPA's own `Numero` is `\p{IsBasicLatin}{1,20}`, and the real
    // vendored XSD below rejects anything longer - found by running this very spec, not guessed.
    const displayNumber = `AC-${timestamp}`;
    const today = new Date().toISOString().slice(0, 10);

    // 1) The FatturaPA, gated exactly the way the transport gates it - the REAL vendored
    //    Schema_VFPR12.xsd, never a hand-written fixture that skips the check.
    const buildResult = await fatturapaFormatProvider.build(
      buildInvoiceDescriptor(),
      {
        id: `doc-live-${timestamp}`,
        data: {
          client: 'live-client',
          issueDate: today,
          dueDate: today,
          currency: 'EUR',
          lines: [
            { description: 'Consulenza di test', quantity: 1, unit: 'unit', unitPrice: 100, vatRate: '22' },
          ],
        },
        displayNumber,
        status: 'sending',
      },
      SELLER,
      BUYER,
    );
    if (!buildResult.validation.valid) {
      throw new Error(
        `the real XSD gate rejected the FatturaPA: ${buildResult.validation.errors.join('; ')}`,
      );
    }
    const xml = Buffer.from(buildResult.bytes);
    console.log('FatturaPA built and XSD-valid, bytes:', xml.length);

    // 2) The REAL round-trip - the exact client `acube-transport.ts` uses in production.
    const client = new AcubeClient({ email, password, environment });
    await client.authenticate();
    console.log('Authenticated against A-Cube, jurisdiction host:', client.getBaseUrl());

    const deposited = await client.sendInvoice(xml);
    console.log('A-Cube POST /invoices response:', JSON.stringify(deposited, null, 2));

    // HARD-SUCCESS CONTRACT - never tolerate a missing uuid (see this file's own header).
    const uuid = typeof deposited?.uuid === 'string' ? deposited.uuid : '';
    if (!uuid) {
      throw new Error(
        `A-Cube did not return a usable invoice uuid - hard failure. Raw response: ${JSON.stringify(deposited)}`,
      );
    }
    console.log('DEPOSIT ACCEPTED - uuid:', uuid);

    // 3) The uuid is only a reference if it can actually be looked up. Read it BACK off the
    //    platform rather than trusting the response we were just handed.
    const refetched = await client.getInvoice(uuid);
    console.log('A-Cube GET /invoices/{uuid} response:', JSON.stringify(refetched, null, 2));
    expect(refetched).toBeTruthy();
    expect(JSON.stringify(refetched)).toContain(uuid);

    // 4) ... and it must be the invoice WE just deposited, not merely some invoice: the document
    //    number travels inside the FatturaPA itself, so finding it back proves the bytes landed.
    expect(JSON.stringify(refetched)).toContain(displayNumber);
  }, 120_000);
});
