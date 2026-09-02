/**
 * REAL round-trip against the FACe SSPP sandbox — root TODO item 10 remainder, ES/FACe wave.
 *
 * Gated `FACE_LIVE=1` + `FACE_CERTIFICATE`/`FACE_CERTIFICATE_PASSWORD`/`FACE_NOTIFICATION_EMAIL`
 * (`../live-gate.ts`), the same shape every sibling channel's own live spec uses:
 *
 *   FACE_LIVE=1 FACE_CERTIFICATE=<base64-pfx> FACE_CERTIFICATE_PASSWORD=<password> \
 *     FACE_NOTIFICATION_EMAIL=facturacion@empresa.es npx jest face.live --no-coverage
 *
 * HONEST STATUS AT THE END OF THIS TASK: **skipped, always** — this checkout holds no FACe-registered
 * certificate (a FNMT/representation certificate is a human, interactive procedure — see
 * `CREDENTIALS_GUIDE.md`'s own FACe section). Nobody has run this file's own `describeLive` blocks
 * with real credentials in CI.
 *
 * WHAT WAS INDEPENDENTLY, MANUALLY LIVE-VERIFIED for this task (2026-09-02, `curl` AND a Node
 * `fetch`, NOT re-run by this file on every ordinary `npm test` — same convention
 * `choruspro-live.spec.ts`'s own header holds for its own manually-verified PISTE OAuth
 * reachability, never turned into an unconditional network-touching test): a genuinely UNSIGNED,
 * empty SOAP body sent directly at `https://se-face-webservice.redsara.es/facturasspp2`, the exact
 * sandbox host `face-client.ts` cites from `josemmo/Facturae-PHP`. The host is REACHABLE and
 * answers, in under 200ms, with a REAL SOAP Fault: `<faultcode>401</faultcode><faultstring>La
 * petición no esta firmada</faultstring>` ("the request is not signed"). REPEATED calls during this
 * task observed the HTTP STATUS itself flip between 200 and 500 for the IDENTICAL fault body — a
 * genuinely flaky/inconsistent status from what is evidently a load-balanced backend, not a mistake
 * in how this was checked (curl and fetch agreed on the body both times, only the status code
 * differed run to run). This independently CONFIRMS, live, both (a) the exact WS-Security gap
 * `face-client.ts`'s own header already documents from reading alone, and (b) that file's own
 * defensive "try to parse a Fault regardless of HTTP status" design is not theoretical caution —
 * it is the ACTUAL observed shape of this specific server. The FIRST `describeLive` block below
 * re-proves this exact fact, but — like every other test in this file — ONLY when explicitly opted
 * into (`FACE_LIVE=1`), never on an ordinary offline `npm test` run.
 *
 * WHY THE GATED BLOCK BELOW CANNOT BE A "HARD SUCCESS" SPEC THE WAY `sdicoop.live.spec.ts`'S OWN IS:
 * that spec's only missing ingredient is AdE accreditation — once granted, a real submission is
 * expected to genuinely succeed. FACe's missing ingredient is DIFFERENT: `FaceSoapHttpPort`
 * (`transports/face-transport.ts`) sends the SOAP envelope UNSIGNED regardless of which certificate a
 * company connects (WS-Security XML-DSig signing is a documented, un-implemented seam — see that
 * file's own header). So even WITH a real FACe-registered certificate, `enviarFactura` through THIS
 * codebase is expected to be rejected with the SAME "no firmada" fault this file already proves live
 * without any credentials — asserting a positive `numeroRegistro` here would be asserting something
 * this codebase cannot currently produce, ever, until WS-Security signing is built. The gated block
 * below therefore proves the NARROWER, still real thing: that a company's connected certificate/email
 * are wired through correctly end-to-end (`buildFaceClient`, `FaceSoapHttpPort`) and the live response
 * is parsed into the SAME honest, named SOAP-fault error `face-transport.ts#send()` would surface to a
 * user — never a silently "successful" no-op, and never a false green from mocks (the project's own
 * "KSeF mock tests = false confidence" lesson).
 */
import { buildFaceClient } from '../face-transport';
import { liveDescribe } from '../live-gate';

const FACE_SANDBOX_ENDPOINT = 'https://se-face-webservice.redsara.es/facturasspp2';

// Flag-only gate (no required credential vars — this check needs none) — still NEVER runs on an
// ordinary `npm test`, only when explicitly opted into. `FACE_LIVE=1 npx jest face.live` runs this
// block alone even without a certificate; adding the three credential vars additionally unlocks the
// second block below.
const describeReachability = liveDescribe('FACE_LIVE');

describeReachability('FACe SSPP — credential-free reachability proof', () => {
  it('the real sandbox is reachable and answers an UNSIGNED request with a genuine SOAP Fault naming the WS-Security gap', async () => {
    const res = await fetch(FACE_SANDBOX_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body:
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
        '<soapenv:Body/></soapenv:Envelope>',
    });
    const body = await res.text();

    // Never a soft "it responded" — but NOT pinned to a specific HTTP status either: repeated calls
    // during this task observed BOTH 500 and 200 for the IDENTICAL fault body (a load-balanced
    // backend that does not consistently map a SOAP Fault to a non-2xx status — see this file's own
    // header, and `face-client.ts#enviarFactura`'s own header, "try to parse a Fault before giving
    // up regardless of status", which is EXACTLY why this ambiguity does not matter to that client).
    // The content is the constant, real signal: a genuine SOAP Fault naming the WS-Security gap.
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(body).toContain('<faultcode>401</faultcode>');
    expect(body).toMatch(/no est.?\s*firmada/i);
  }, 15000);
});

const describeLive = liveDescribe('FACE_LIVE', [
  'FACE_CERTIFICATE',
  'FACE_CERTIFICATE_PASSWORD',
  'FACE_NOTIFICATION_EMAIL',
]);

describeLive(
  "FACe SSPP live round-trip (sandbox) — see this file's own header for what this can and cannot prove",
  () => {
    it('a real enviarFactura call is rejected with the SAME named WS-Security fault — never a silent/fake success', async () => {
      const certificate = process.env.FACE_CERTIFICATE!;
      const certificatePassword = process.env.FACE_CERTIFICATE_PASSWORD!;
      const notificationEmail = process.env.FACE_NOTIFICATION_EMAIL!;

      const client = buildFaceClient({ certificate, certificatePassword, notificationEmail }, 'TEST');

      // A tiny placeholder body is enough — this call is expected to be rejected at the WS-Security
      // layer before FACe ever looks at the Facturae content itself (see this file's own header).
      const facturaBase64 = Buffer.from('<fe:Facturae/>', 'utf-8').toString('base64');

      await expect(
        client.enviarFactura({
          correo: notificationEmail,
          facturaBase64,
          facturaNombre: 'face-live-0000001.xml',
        }),
      ).rejects.toThrow(/firmad/i);
    }, 15000);
  },
);
