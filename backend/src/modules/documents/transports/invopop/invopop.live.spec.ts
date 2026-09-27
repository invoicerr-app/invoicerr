/**
 * REAL round-trip against an Invopop SANDBOX workspace. Gated the same way every other live spec in
 * this module is (`liveDescribe`, `transports/live-gate.ts`): skipped silently unless `INVOPOP_LIVE=1`
 * AND the credentials are present, so CI stays green without them.
 *
 *   cd backend && set -a; . .env.test.local; set +a
 *   INVOPOP_LIVE=1 npx vitest run src/modules/documents/transports/invopop/invopop.live.spec.ts
 *
 * DB-FREE ON PURPOSE, the same choice `pdp/pdp.live.spec.ts` makes and for the same reason: that
 * command never sets `DATABASE_URL`, so this spec never touches Prisma. It does not call
 * `invopop-transport.ts`'s exported `send()` (which reads `Company`/`Client` rows); it calls the SAME
 * DB-free building blocks that function composes, by hand:
 *
 *   buildInvoiceDescriptor + computeDocumentTotals   (pure - descriptor → totals, no DB)
 *        → buildGoblInvoice                          (pure - the GOBL bridge, no DB)
 *        → InvopopClient (REAL) .putSiloEntry() + .putJob() + .getSiloEntry()
 *
 * Unlike the PDP spec, NOTHING is substituted: there is no PDF to render, because Invopop takes GOBL
 * JSON and builds the country syntax itself (see `gobl-invoice.ts`'s own header). Every step that
 * matters to conformity runs for real against the real sandbox.
 *
 * HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md), the same four refusals
 * `invopop-transport.ts` enforces in production:
 *   - an empty silo entry id is a FAILURE;
 *   - a job carrying `faults` is a FAILURE even when its `status` reads "OK" - the platform's own
 *     documentation says an error branch that ran leaves exactly that combination behind;
 *   - a payable total the platform recomputed differently is a FAILURE (GOBL replaces supplied totals
 *     silently, so the returned number is the only signal there is);
 *   - and, before any of that, a workspace whose `sandbox` flag is not true aborts the whole suite:
 *     a test must never deposit an invoice into a LIVE workspace.
 *
 * The parties below are synthetic. Their SIREN values satisfy the Luhn check and their VAT keys the
 * French `(12 + 3 x SIREN mod 97) mod 97` rule, because GOBL validates both and answers
 * `GOBL-FR-TAX-IDENTITY-01` otherwise (verified live) - made-up digits do not get past the build.
 */
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { SemanticPartyInput } from '../../formats/semantic/build-semantic-invoice';
import { computeDocumentTotals } from '../../totals/compute-totals';
import { liveDescribe } from '../live-gate';
import { buildGoblInvoice } from './gobl-invoice';
import { InvopopClient } from './invopop-client';
import { invopopDeterministicId } from './invopop-ids';

const describeLive = liveDescribe('INVOPOP_LIVE', ['INVOPOP_API_KEY', 'INVOPOP_WORKFLOW_ID']);

const SELLER: SemanticPartyInput = {
  name: 'Invoicerr Live Seller',
  address: '809 avenue du Languedoc',
  city: 'Millau',
  postalCode: '12100',
  country: 'France',
  email: 'seller@example.fr',
  partyIdentifiers: [{ scheme: 'VAT', value: 'FR11123456782' }],
};

const BUYER: SemanticPartyInput = {
  name: 'Invoicerr Live Buyer',
  address: '1 rue de Tricatel',
  city: 'Paris',
  postalCode: '75001',
  country: 'France',
  email: 'buyer@example.fr',
  partyIdentifiers: [{ scheme: 'VAT', value: 'FR82404847824' }],
};

describeLive('Invopop live round-trip (sandbox) - GOBL deposit accepted and workflow run', () => {
  it('buildGoblInvoice → real silo entry → real workflow job → signed envelope back', async () => {
    const apiKey = process.env.INVOPOP_API_KEY ?? '';
    const workflowId = process.env.INVOPOP_WORKFLOW_ID ?? '';
    const baseUrl = process.env.INVOPOP_BASE_URL || undefined;

    const client = new InvopopClient({ apiKey, baseUrl });

    // ── 1) The token reaches the API at all. A 403 here would be Cloudflare, not a bad token. ──
    expect(await client.ping()).toBe(true);

    // ── 2) Refuse to deposit anywhere but a sandbox. There is no separate sandbox HOST - the token
    // carries the workspace - so this flag is the only guard there is. ──
    const workspace = await client.getWorkspace();
    console.log('Workspace:', { name: workspace.name, slug: workspace.slug, sandbox: workspace.sandbox });
    if (workspace.sandbox !== true) {
      throw new Error(
        `Refusing to run: workspace "${workspace.slug ?? workspace.id}" is NOT a sandbox. ` +
          'This spec deposits real documents.',
      );
    }

    // ── 3) The exact production recipe, by hand: descriptor → totals → GOBL. ──
    const timestamp = Date.now();
    const code = `INV-LIVE-${timestamp}`;
    const descriptor = buildInvoiceDescriptor();
    const today = new Date().toISOString().slice(0, 10);
    const data = {
      client: 'live-client',
      issueDate: today,
      dueDate: today,
      currency: 'EUR',
      lines: [
        { description: 'Consulting services', quantity: 2, unit: 'hour', unitPrice: 100, vatRate: '20' },
        { description: 'Delivery', quantity: 1, unit: 'unit', unitPrice: 50, vatRate: '0' },
      ],
    };
    const totals = computeDocumentTotals(descriptor, data);

    const goblInvoice = buildGoblInvoice({
      code,
      issueDate: data.issueDate,
      dueDate: data.dueDate,
      currency: 'EUR',
      seller: SELLER,
      buyer: BUYER,
      lines: data.lines.map((line, index) => ({
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        vatRatePercent: totals.lines[index]?.vatRatePercent ?? null,
      })),
      notes: 'Live integration test - Invopop sandbox.',
    });
    console.log('GOBL document built:', JSON.stringify(goblInvoice));

    // ── 4) The REAL round-trip - the exact client `invopop-transport.ts` uses in production. ──
    // The SAME id helper production uses, with this run's own synthetic document id - which also
    // proves, for real, that the platform accepts the UUIDv7 shape it derives (Invopop enforces the
    // UUID version per silo folder, so a wrong one is refused outright).
    const entryId = invopopDeterministicId(code, 'entry', timestamp);
    const entry = await client.putSiloEntry(entryId, goblInvoice);
    console.log(
      'Silo entry:',
      JSON.stringify({ id: entry.id, folder: entry.folder, snippet: entry.snippet }),
    );

    // HARD-SUCCESS: an accepted write with no usable id is a failure, never a silent success.
    if (!entry || String(entry.id ?? '') === '') {
      throw new Error(`Invopop returned no silo entry id - hard failure. Raw: ${JSON.stringify(entry)}`);
    }

    const jobId = invopopDeterministicId(code, 'job', timestamp);
    const job = await client.putJob(jobId, { workflowId, siloEntryId: entry.id, waitSeconds: 30 });
    console.log(
      'Workflow job:',
      JSON.stringify({
        id: job.id,
        status: job.status,
        completed_at: job.completed_at,
        intents: (job.intents ?? []).map((i) => ({
          name: i.name,
          provider: i.provider,
          events: (i.events ?? []).map((e) => e.status),
        })),
        faults: job.faults,
      }),
    );

    // HARD-SUCCESS: faults, not `status`, are the authoritative record - a job whose step failed and
    // whose error branch then ran reports `status: "OK"` and still carries faults.
    if (job.faults && job.faults.length > 0) {
      throw new Error(`Invopop workflow reported faults: ${JSON.stringify(job.faults)}`);
    }
    expect(job.completed_at).toBeTruthy();

    // ── 5) The entry as the workflow left it. ──
    const stored = await client.getSiloEntry(entry.id);
    const built = (stored.data as { doc?: { totals?: { payable?: string } } } | undefined)?.doc;
    console.log(
      'Stored entry after the job:',
      JSON.stringify({ signed: stored.signed, totals: built?.totals }),
    );

    // The workflow this spec runs ends in a "Sign envelope" step, so the envelope must come back
    // signed - anything else means the workflow did not do what it says.
    expect(stored.signed).toBe(true);

    // HARD-SUCCESS: GOBL recalculates every total and silently replaces any supplied one, so the only
    // way to know the two engines agree is to compare what came back.
    const expectedPayable = (totals.grossMinor / 100).toFixed(2);
    expect(built?.totals?.payable).toBe(expectedPayable);
  }, 90_000);
});
