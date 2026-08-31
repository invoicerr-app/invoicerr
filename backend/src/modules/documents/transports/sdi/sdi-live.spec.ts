/**
 * REAL round-trip against SdI (Sistema di Interscambio) — root TODO item 10, wave 2. Gated the same
 * way the repère's own `sdi-live.spec.ts` was (`SDI_LIVE=1` + `SDI_ID_TRASMITTENTE`/
 * `SDI_CERTIFICATE`/`SDI_CERT_PASSWORD` — `../live-gate.ts`), run the same way:
 *
 *   SDI_LIVE=1 SDI_ID_TRASMITTENTE=IT01234567890 SDI_CERTIFICATE=<base64-pfx> \
 *     SDI_CERT_PASSWORD=<password> npx jest sdi-live --no-coverage
 *
 * **DEFERRED, STILL, TODAY** — exactly as it was at the repère: real SdI access requires AdE
 * (Agenzia delle Entrate) intermediary accreditation and a qualified PFX certificate, NEITHER
 * obtained (see `sdi-transport.ts`'s own header and this task's own report). This file does NOT
 * fabricate a sandbox or a fake SOAP endpoint to force a green run — `liveDescribe` skips cleanly
 * whenever the flag/creds are absent, which is every run today, and says so on stderr.
 *
 * What running this WOULD prove, the day accreditation lands: `fatturapa-provider.ts`'s real vendored
 * `Schema_VFPR12.xsd` gate, then a real SDICoop submission via `SdiClient` with an actually-accredited
 * `SdiHttpPort` (still to be built — `sdi/sdi-client.ts`'s own `UNACCREDITED_SDI_HTTP_PORT` is what
 * this spec would need to replace first), then polling `getStatus()` for an RC/DT/AT notifica
 * (`SdiClient.mapNotifica` → CLEARED). HARD-SUCCESS CONTRACT for that future spec, stated here so
 * whoever builds the accredited port does not have to rediscover it: a REJECTED (NS/`EC02`) or a
 * `PENDING` result that never resolves is a FAILURE, never tolerated as a soft pass — the same
 * discipline `ksef/ksef-live.spec.ts` already enforces for the channel that IS proven.
 */
import { liveDescribe } from '../live-gate';

const describeLive = liveDescribe('SDI_LIVE', [
  'SDI_ID_TRASMITTENTE',
  'SDI_CERTIFICATE',
  'SDI_CERT_PASSWORD',
]);

describeLive('SdI live round-trip — DEFERRED pending AdE intermediary accreditation', () => {
  it('is not attempted: no accredited SdiHttpPort exists yet in this codebase', () => {
    // Reached only once SDI_LIVE=1 AND every credential above is set — which, today, is never (see
    // this file's own header). If this ever DOES run, it means credentials finally exist and the
    // honest next step is to build the accredited `SdiHttpPort` this spec would then exercise for
    // real, not to fill in this placeholder with a soft pass.
    throw new Error(
      'SDI_LIVE=1 was set, but this codebase has no accredited SdiHttpPort implementation yet ' +
        '(sdi/sdi-client.ts still ships only UNACCREDITED_SDI_HTTP_PORT). Build the real SDICoop ' +
        'client first — do not weaken this into a soft pass.',
    );
  });
});
