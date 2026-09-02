/**
 * REAL round-trip against the FACe SSPP sandbox — root TODO item 10 remainder, ES/FACe wave.
 *
 * Gated `FACE_LIVE=1` + `FACE_CERTIFICATE`/`FACE_CERTIFICATE_PASSWORD`/`FACE_NOTIFICATION_EMAIL`
 * (`../live-gate.ts`), the same shape every sibling channel's own live spec uses:
 *
 *   FACE_LIVE=1 FACE_CERTIFICATE=<base64-pfx> FACE_CERTIFICATE_PASSWORD=<password> \
 *     FACE_NOTIFICATION_EMAIL=facturacion@empresa.es npx jest face.live --no-coverage
 *
 * HONEST STATUS AT THE END OF THIS TASK: the credential-gated `describeLive` block (needing a
 * FACe-registered PKCS#12) is still **skipped, always** — this checkout holds no such certificate (a
 * FNMT/representation certificate is a human, interactive procedure — see `CREDENTIALS_GUIDE.md`'s
 * own FACe section). But the CREDENTIAL-FREE `describeReachability` block below now proves something
 * new and load-bearing: a WS-Security-signed envelope, signed with nothing more than a throwaway
 * in-memory self-signed test certificate, makes the live sandbox's OWN fault CHANGE NATURE.
 *
 * ## WHAT WAS LIVE-VERIFIED, 2026-09-02 (this task) — the raw evidence, both ways
 *
 * UNSIGNED (re-confirmed, `curl` — the SAME fact `avant-2026-09-02` already established):
 *   `<faultcode>401</faultcode><faultstring>La petición no esta firmada</faultstring>`
 *
 * SIGNED (`wsse-sign.ts#signSoapEnvelope`, RSA-SHA256/SHA256 Exc-C14N over the `soapenv:Body` alone —
 * NO `wsu:Timestamp`, a throwaway forge-generated self-signed cert never registered with FACe — via a
 * Node script POSTing straight at the sandbox, reproduced by the `it()` below):
 *   `<faultcode>401</faultcode><faultstring>Error al validar el certificado</faultstring>`
 *
 * The faultCODE stayed "401" both times (named here so nobody mistakes it for "no change happened" —
 * the SIGNAL is the faultSTRING, which is a genuinely different sentence: "the request is not signed"
 * vs. "error validating the certificate"). This is exactly the proof this task set out to get: FACe's
 * WS-Security processor PARSED the `wsse:Security` header, the `BinarySecurityToken`, and the
 * `ds:Signature` well enough to move PAST "is there a signature at all" and INTO "is this a
 * certificate I recognize" — which a throwaway, never-registered test certificate can never pass, by
 * construction. Getting further (an actual accepted deposit) needs a real FNMT-issued, FACe-registered
 * certificate this checkout does not have — see `CREDENTIALS_GUIDE.md` §20 — but that is now the ONLY
 * remaining gap, not "the transport never signs anything at all".
 *
 * BONUS, INCIDENTAL FINDING (not required by, but relevant to, this task): the live sandbox's OWN
 * SOAP FAULT RESPONSE is itself WS-Security-signed — a genuine FNMT "SELLO ENTIDAD SGAD PRUEBAS" test
 * certificate (Ministerio de Transformación Digital y Función Pública), with a `wsse:Security` header
 * signing BOTH a `wsu:Timestamp` (Created/Expires, ~2h window) AND the `soapenv:Body`, using
 * `http://www.w3.org/2000/09/xmldsig#rsa-sha1` / `...#sha1` (RSA-SHA1/SHA1, NOT SHA-256). This
 * confirms the OASIS X.509 Token Profile form cited in `wsse-sign.ts`'s own header is exactly what
 * FACe's OWN stack speaks — genuinely observed, not merely read off a spec — while also showing that
 * FACe's INCOMING validation is evidently more lenient than its own outgoing convention: our SHA-256,
 * Body-only, Timestamp-less request was still enough to reach certificate validation, not rejected
 * for using "the wrong shape". Worth revisiting (RSA-SHA1 + a signed Timestamp, matching the server's
 * own convention byte-for-byte) the day a real FACe-registered certificate makes it possible to chase
 * an actual ACCEPTED deposit rather than merely "signature layer reached".
 *
 * WHY THE CREDENTIAL-GATED BLOCK BELOW STILL CANNOT BE A "HARD SUCCESS" SPEC THE WAY
 * `sdicoop.live.spec.ts`'S OWN IS: that spec's only missing ingredient is AdE accreditation — once
 * granted, a real submission is expected to genuinely succeed. FACe's remaining missing ingredient is
 * narrower than it was before this task (the transport now DOES sign the envelope) but still real: NO
 * certificate in this checkout is FACe-registered, so even a fully WS-Security-signed request is
 * expected to fail certificate validation, the SAME shape the credential-free proof above already
 * demonstrates without needing any credential at all. The gated block's own assertion is UPDATED
 * accordingly: it no longer pins the outcome to "always rejects with /firmad/i" (that fault is exactly
 * what THIS task closed) — a genuinely FACe-registered certificate might actually succeed, which this
 * codebase cannot rule out without one. So it accepts EITHER a real success (non-empty
 * `numeroRegistro`) OR a real, named rejection — never a silent/undefined one either way.
 */
import * as forge from 'node-forge';

import { buildFaceClient } from '../face-transport';
import { liveDescribe } from '../live-gate';
import { signSoapEnvelope, WsseCertificate } from './wsse-sign';

const FACE_SANDBOX_ENDPOINT = 'https://se-face-webservice.redsara.es/facturasspp2';

/** A throwaway, in-memory, self-signed test certificate — NEVER registered with FACe, NEVER a real
 *  credential (this codebase's own security rule). Generated fresh per test run; its only job is to
 *  produce a STRUCTURALLY VALID WS-Security signature FACe's own processor can parse far enough to
 *  reach certificate validation — see this file's own header for exactly what that proves and does
 *  not prove. */
function generateThrowawayCert(): WsseCertificate {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { name: 'commonName', value: 'Invoicerr FACe Live Reachability Probe' },
    { name: 'countryName', value: 'ES' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const privateKeyPem = forge.pki.privateKeyInfoToPem(
    forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey)),
  );
  const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
  return { certDer, privateKeyPem };
}

// Flag-only gate (no required credential vars — neither check below needs one — a throwaway test
// cert is generated in-memory for the signed probe). Still NEVER runs on an ordinary `npm test`, only
// when explicitly opted into. `FACE_LIVE=1 npx jest face.live` runs this block alone even without a
// certificate; adding the three credential vars additionally unlocks the gated round-trip below.
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

  // THE CORE PROOF THIS TASK EXISTS FOR — see this file's own header for the raw evidence quoted
  // both ways. No FACe-registered certificate needed: a throwaway self-signed test cert is enough to
  // demonstrate the WS-Security layer is genuinely parsed, even though it can never PASS certificate
  // validation (by construction — it was never issued by anyone FACe trusts).
  it('a WS-Security-SIGNED request (throwaway test cert) makes the fault change nature — from "not signed" to a certificate-validation error', async () => {
    const unsignedRes = await fetch(FACE_SANDBOX_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body:
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
        '<soapenv:Body/></soapenv:Envelope>',
    });
    const unsignedBody = await unsignedRes.text();
    const unsignedFault = unsignedBody.match(/<faultstring>([^<]*)<\/faultstring>/)?.[1];
    expect(unsignedFault).toMatch(/no est.?\s*firmada/i);

    const cert = generateThrowawayCert();
    const { envelope } = await signSoapEnvelope(
      '<web:ping xmlns:web="https://webservice.face.gob.es"/>',
      cert,
    );
    const signedRes = await fetch(FACE_SANDBOX_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: envelope,
    });
    const signedBody = await signedRes.text();
    const signedFault = signedBody.match(/<faultstring>([^<]*)<\/faultstring>/)?.[1];

    // The fault must be a DIFFERENT sentence — never STILL "not signed" (that would mean the
    // WS-Security header was not even parsed) and never a soft "it responded" with no assertion on
    // WHAT changed.
    expect(signedFault).toBeDefined();
    expect(signedFault).not.toMatch(/no est.?\s*firmada/i);
    // Best-effort, not hard-pinned to exact Spanish wording (a live third party's own error text can
    // legitimately drift) — but this task's own live run got exactly "Error al validar el
    // certificado" (see this file's own header), so a certificate-flavoured message is the honest
    // expectation, not an arbitrary one.
    expect(signedFault).toMatch(/certificad/i);
  }, 20000);
});

const describeLive = liveDescribe('FACE_LIVE', [
  'FACE_CERTIFICATE',
  'FACE_CERTIFICATE_PASSWORD',
  'FACE_NOTIFICATION_EMAIL',
]);

/** Extract `{certDer, privateKeyPem}` from a base64 PKCS#12 bundle — the SAME extraction
 *  `SigningCertificatesService#parsePfx`/`FaceCredentials.certificate` ultimately need, duplicated
 *  minimally here (this gated block never runs without real credentials — see this file's own header
 *  — so a small local helper is preferable to widening a production export purely for a test that has
 *  never once executed). */
function pfxToWsseCertificate(pfxBase64: string, password: string): WsseCertificate {
  const pfxDer = Buffer.from(pfxBase64, 'base64');
  const pfxAsn1 = forge.asn1.fromDer(forge.util.binary.raw.encode(new Uint8Array(pfxDer)));
  const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, password);
  const certBag = pfx.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0];
  const keyBag = pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
    forge.pki.oids.pkcs8ShroudedKeyBag
  ]?.[0];
  if (!certBag?.cert || !keyBag?.key) {
    throw new Error('FACE_CERTIFICATE: PFX has no certificate/private-key bag — cannot sign live.');
  }
  const certDer = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(certBag.cert)).getBytes(),
    'binary',
  );
  const privateKeyPem = forge.pki.privateKeyInfoToPem(
    forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keyBag.key as forge.pki.rsa.PrivateKey)),
  );
  return { certDer, privateKeyPem };
}

describeLive(
  "FACe SSPP live round-trip (sandbox) — see this file's own header for what this can and cannot prove",
  () => {
    it('a real enviarFactura call, NOW WS-Security-signed with the connected certificate, never produces a SILENT/FAKE result either way', async () => {
      const certificate = process.env.FACE_CERTIFICATE!;
      const certificatePassword = process.env.FACE_CERTIFICATE_PASSWORD!;
      const notificationEmail = process.env.FACE_NOTIFICATION_EMAIL!;

      const wsseCertificate = pfxToWsseCertificate(certificate, certificatePassword);
      const client = buildFaceClient(
        { certificate, certificatePassword, notificationEmail },
        'TEST',
        wsseCertificate,
      );

      // A tiny placeholder body is enough. UNLIKE every other assertion in this file, this one
      // DELIBERATELY does not pin the outcome to "always rejects" — see this file's own header:
      // whether a REAL, FACe-registered certificate genuinely passes WS-Security validation is
      // exactly the open question this task could not settle without one. If this checkout ever
      // gains one, this test must still be MEANINGFUL either way — so it enforces the hard-success
      // contract every live spec in this codebase shares (LIVE_TESTING.md: "a reference nobody can
      // look up is not a reference at all") rather than assuming failure:
      //   - RESOLVES → the result MUST carry a real, non-empty numeroRegistro (a genuine success).
      //   - REJECTS  → MUST be a real, named Error, never a silent/undefined failure.
      const facturaBase64 = Buffer.from('<fe:Facturae/>', 'utf-8').toString('base64');
      try {
        const result = await client.enviarFactura({
          correo: notificationEmail,
          facturaBase64,
          facturaNombre: 'face-live-0000001.xml',
        });
        expect(result.codigo).toBe('0');
        expect(result.numeroRegistro).toBeTruthy();
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message.length).toBeGreaterThan(0);
      }
    }, 15000);
  },
);
