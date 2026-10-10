/**
 * Issue #472 - REAL round-trip of a CREDIT NOTE against the superpdp sandbox, the one platform with a
 * sandbox already wired up and credentials on hand locally. Same gate, same recipe and same parties as
 * `superpdp.live.spec.ts` (see its own header for why this is DB-free and why a pdf-lib page stands in for
 * the human PDF); the only differences are the ones issue #472 adds: an invoice is deposited FIRST, then
 * a credit note correcting it - BT-3 381 and BG-3 (BT-25/BT-26) naming that invoice, exactly what
 * `formats/credit-note-source.ts` + `buildSemanticInvoice({ creditNote })` produce for a real linked
 * credit note.
 *
 *   cd backend && set -a; . .env.test.local; set +a
 *   SUPERPDP_LIVE=1 npx vitest run src/modules/documents/transports/pdp/superpdp-credit-note.live.spec.ts
 *
 * HARD-SUCCESS CONTRACT, same as the invoice spec: an empty deposit id, or any event whose text reads as a
 * rejection, throws.
 */
import { liveDescribe } from '../live-gate';
import {
  awaitLiveVerdict,
  buildLiveFacturx,
  depositLiveFacturx,
  findRejection,
} from './superpdp-live-facturx';
import {
  resolveSandboxCompany,
  SUPERPDP_BUYER_ENV,
  SUPERPDP_LIVE_ENV,
  sandboxBuyer,
  superpdpLiveClient,
} from './superpdp-live-parties';

const describeLive = liveDescribe('SUPERPDP_LIVE', [...SUPERPDP_LIVE_ENV, ...SUPERPDP_BUYER_ENV]);

describeLive('PDP live round-trip (superpdp sandbox) - a credit note (381 + BG-3) after its invoice', () => {
  it('deposits an invoice, then a credit note correcting it; both reach a non-rejected fr:2xx verdict', async () => {
    const client = superpdpLiveClient();
    await client.authenticate();
    const seller = await resolveSandboxCompany(client);
    const buyer = sandboxBuyer();
    const today = new Date().toISOString().slice(0, 10);
    const timestamp = Date.now();

    async function deposit(
      displayNumber: string,
      correctedInvoice?: { displayNumber: string; issueDate: string },
    ) {
      const facturx = await buildLiveFacturx({
        displayNumber,
        seller,
        buyer,
        description: 'Prestation de test (issue #472)',
        creditNote: correctedInvoice ? { correctedInvoice } : undefined,
        businessProcess: 'profile',
      });
      const sent = await depositLiveFacturx(client, facturx, displayNumber);
      const events = await awaitLiveVerdict(client, Number(sent.id));
      const rejected = findRejection(events);
      if (rejected) throw new Error(`superpdp rejected ${displayNumber}: ${JSON.stringify(rejected)}`);
      expect(events.some((e) => e.status_code?.startsWith('fr:2'))).toBe(true);
      return sent;
    }

    const invoiceNumber = `INV-LIVE-472-${timestamp}`;
    await deposit(invoiceNumber);
    await deposit(`CN-LIVE-472-${timestamp}`, { displayNumber: invoiceNumber, issueDate: today });
  }, 90_000);
});
