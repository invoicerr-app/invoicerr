/**
 * REAL round-trip against the superpdp sandbox. Gated through `live-gate.ts` (`SUPERPDP_LIVE=1` + credential
 * env vars), the same gate the reference's own `pdp-live.spec.ts` used, and run like this:
 *
 *   cd backend && set -a; . .env.test.local; set +a
 *   SUPERPDP_LIVE=1 npx vitest run superpdp.live --no-file-parallelism
 *
 * DB-FREE ON PURPOSE, same choice the reference's own spec made (see its own "(DB-free)" comment): that
 * exact command above never sets DATABASE_URL, so this spec never touches Prisma — it does not call
 * `pdp-transport.ts`'s exported `send()` (which reads `Company`/`Client` rows), it calls the SAME
 * underlying, DB-free building blocks that function composes, by hand:
 *
 *   buildInvoiceDescriptor + computeDocumentTotals  (pure — descriptor → totals, no DB)
 *        → buildSemanticInvoice                      (pure — the semantic bridge, `shared-build.ts`'s
 *                                                       own dependency, no DB)
 *        → newEuInvoiceService().generate(..., 'CII') → splitCiiIncludedNotes → validateStructural +
 *          validateSchematron                         (the EXACT gate `facturx-provider.ts` runs —
 *                                                       ported here rather than imported, since that
 *                                                       provider's own `build()` needs a companyId to
 *                                                       call `renderDocumentInstance`, which DOES hit
 *                                                       Prisma + Puppeteer — see its own header)
 *        → newEuInvoiceService().generate(..., 'Factur-X-EN16931', { pdf: <a real, pdf-lib-built PDF> })
 *        → PdpClient (REAL, `pdp/pdp-client.ts`) .authenticate() + .sendInvoice()
 *
 * A minimal, valid PDF from `pdf-lib` stands in for the "human" PDF `rendering/render-instance-pdf.ts`
 * would normally produce — the ONLY piece of the real send() path this spec does not exercise, and
 * the one Puppeteer/DB-coupled leaf that has nothing to do with EN 16931 conformity (the embedded
 * CII, not the human-readable page, is what superpdp's own conformity check reads). Everything that
 * DOES matter to conformity — the semantic bridge, the vendored Schematron gate, the actual Factur-X
 * PDF/A-3 embedder, the actual HTTP round-trip — runs for REAL, unmocked, against the real sandbox.
 *
 * HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md): a REJECTED/SKIPPED
 * outcome or an EMPTY deposit id is a FAILURE, never tolerated — this spec throws rather than assert
 * a soft `expect().toBeFalsy()` that could quietly pass on a shrugging response. The original
 * contract stopped at "the deposit was ACCEPTED" (a non-empty id back from `POST /v1.beta/invoices`),
 * deliberately not following the conformity verdict any further at the time — see
 * `pdp-transport.ts`'s own header for that named remainder, and this file's own
 * git history for why: a poller that could only ever answer PENDING would have been a false green.
 *
 * STRENGTHENED (BT-23): once the last cited rejection cause
 * (BR-FR-08/BT-23 — see `business-process.ts`'s own header for the full wiring this fixes) stopped
 * appearing, the verdict genuinely turned stable and positive — not PENDING, and not once but reproduced
 * across two independent live deposits before this file's own assertion below was tightened: both
 * reached `fr:202` ("Reçue par la plateforme") within ~1-2s of upload, past `fr:200` ("Déposée
 * (validée)") and `fr:201` ("Émise par la plateforme"), with NO `reason` on any event — the first
 * FULL conformity verdict this architecture has produced, not merely an accepted upload. The block at
 * the end of this test now asserts on that directly (a short retry loop, not a fixed sleep — this
 * platform's own verdict lands in well under a second, see the log timestamps above), while the
 * original contract above is UNCHANGED and still the FIRST thing checked: this only adds a
 * strictly stronger claim on top, never a softer one in its place.
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

describeLive('PDP live round-trip (superpdp sandbox) — Factur-X deposit accepted', () => {
  it('buildEuInvoice → real EN16931 Schematron gate → real Factur-X embed → real superpdp deposit', async () => {
    const client = superpdpLiveClient();
    await client.authenticate();
    const timestamp = Date.now();

    const facturxPdf = await buildLiveFacturx({
      displayNumber: `INV-LIVE-${timestamp}`,
      seller: await resolveSandboxCompany(client),
      buyer: sandboxBuyer(),
      description: 'Prestation de test (item 10, wave 1)',
      businessProcess: 'profile',
    });
    expect(Buffer.from(facturxPdf.slice(0, 5)).toString()).toBe('%PDF-');
    console.log('Factur-X PDF built, bytes:', facturxPdf.length);

    // HARD-SUCCESS CONTRACT: an empty deposit id throws inside `depositLiveFacturx`.
    const invoice = await depositLiveFacturx(client, facturxPdf, `INV-LIVE-${timestamp}`);
    expect(String(invoice.id)).not.toBe('');

    // BT-23: the verdict must turn stable and positive, and no event may cite a rejection or BT-23,
    // checked across every event, not just the latest.
    const events = await awaitLiveVerdict(client, Number(invoice.id));
    const allReasons = events.map((e) => JSON.stringify(e.data?.reason ?? '')).join(' ');
    expect(allReasons).not.toContain('BT-23');
    expect(events.some((e) => e.status_code?.startsWith('fr:2'))).toBe(true);
    const rejectedEvent = findRejection(events);
    if (rejectedEvent) {
      throw new Error(`superpdp reported a rejection: ${JSON.stringify(rejectedEvent)}`);
    }
  }, 60_000);
});
