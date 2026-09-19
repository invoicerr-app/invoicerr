import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { defineConfig } from "cypress";
import { Queue } from "bullmq";
import { Client } from "pg";
import pdfParse from "pdf-parse";
import jsQR from "jsqr";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { extractSignature } from "@signpdf/utils";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { webcrypto } from "node:crypto";

// One-time engine registration for pkijs's own cryptographic verify — mirrors
// `signing/providers.ts#ensureXmlCryptoEngine`'s identical "native WebCrypto" registration the
// backend's own jest suite (`providers.spec.ts`) already does for the SAME library, for the CAdES
// side of this exact feature. Needed once, at MODULE load (not per-task-call): `pkijs.setEngine`
// sets library-wide state.
pkijs.setEngine("native", new pkijs.CryptoEngine({ crypto: webcrypto as unknown as Crypto }));

/**
 * The "receiver" side for `42-webhooks.cy.ts`. A vanilla
 * `node:http` server, started ONCE for the whole run (module-level state in this Node plugin
 * process — the same process every `on("task", ...)` handler already runs in, see the file's other
 * tasks above), because the backend under test needs a REAL, network-reachable URL to POST to: a
 * `cy.intercept` only ever sees traffic the BROWSER makes, never a server-to-server POST the backend
 * issues on its own (`WebhookDispatcherService` → `GenericDriver` → `fetch`). Same host, same
 * "localhost" reachability every other e2e port already relies on (Postgres :5433, Redis :6399,
 * Mailpit :1025/:8025) — the backend and Cypress run on the SAME machine in this harness, never
 * across a container boundary that would make "localhost" mean something different to each side.
 */
let webhookReceiverUrl: string | null = null;
const receivedWebhookRequests: unknown[] = [];

function startWebhookReceiver(): Promise<string> {
  if (webhookReceiverUrl) return Promise.resolve(webhookReceiverUrl);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        let body: unknown = raw;
        try {
          body = JSON.parse(raw);
        } catch {
          // GenericDriver always sends JSON — an unparsable body would itself be a finding, kept
          // as the raw string rather than swallowed.
        }
        receivedWebhookRequests.push(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      webhookReceiverUrl = `http://127.0.0.1:${address.port}`;
      resolve(webhookReceiverUrl);
    });
  });
}

/**
 * The "PDP sandbox" side for `74-received-invoice-inbound.cy.ts` — a vanilla `node:http` server,
 * same "started once, module-level state, real network-reachable URL" shape as
 * `startWebhookReceiver` just above, for the SAME underlying reason: `PdpReceptionSweepRunner`
 * (backend) makes its own server-to-server HTTP calls (OAuth2 token, `listInvoices`,
 * `downloadInvoiceFile`) — a `cy.intercept` only ever sees traffic the BROWSER makes.
 *
 * Answers the exact THREE endpoints `pdp-reception-poller.ts`/`pdp-reception.ts` actually call —
 * shaped exactly like the REAL superpdp sandbox, LIVE-VERIFIED 2026-09-16
 * (`backend/src/modules/documents/transports/pdp/pdp-reception.live.spec.ts`'s own header has the
 * full evidence): `POST /oauth2/token`, `GET /v1.beta/invoices?direction=in`, and
 * `GET /v1.beta/invoices/{id}?format=original` (raw bytes, `content-type` from `setFakePdpInbox`'s
 * own `contentType`). `POST /v1.beta/invoices/{id}/lifecycle_events` answers 200 — never re-proving
 * the real sandbox's own documented 404 gap here (already proven live, see the file cited above);
 * this fake stays a well-behaved PDP so the e2e assertions stay about the SCREEN, not this detail.
 *
 * The inbox is MUTABLE (`setFakePdpInbox`/`resetFakePdpServer`) rather than a fixed canned response:
 * the spec drives it to first hold ZERO deposits (proving the sweep is a genuine no-op with nothing
 * to import), then ONE, then a SECOND — the real BullMQ job is triggered fresh each time
 * (`triggerPdpReceptionSweep`, below) rather than relying on the real repeatable's own interval.
 */
interface FakePdpInboundInvoice {
  id: number;
  createdAt: string;
  /** Path under `cypress/fixtures/` to the ORIGINAL file bytes this deposit serves — reused real
   *  fixtures (never hand-written), the same discipline `36-received-invoices.cy.ts` already holds. */
  fixturePath: string;
  contentType: string;
}

let fakePdpServerUrl: string | null = null;
let fakePdpInbox: FakePdpInboundInvoice[] = [];
const fakePdpLifecycleEvents: Array<{ invoiceId: string; code: string }> = [];
// Counts real hits to the "list inbound invoices" endpoint — `74-received-invoice-inbound.cy.ts`'s
// own "empty inbox" test needs to tell "the sweep ran and genuinely found nothing" apart from "the
// sweep never ran at all" (an empty `listReceivedInvoices()` result looks identical either way). A
// count that actually incremented is proof the REAL `PdpReceptionSweepRunner` reached this fake
// server over the network, not merely that no row got written.
let fakePdpListCallCount = 0;

function startFakePdpServer(): Promise<string> {
  if (fakePdpServerUrl) return Promise.resolve(fakePdpServerUrl);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://fake-pdp.local");

      if (req.method === "POST" && url.pathname === "/oauth2/token") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: "e2e-fake-pdp-token", token_type: "Bearer", expires_in: 3600 }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1.beta/invoices" && url.searchParams.get("direction") === "in") {
        fakePdpListCallCount += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: fakePdpInbox.map((inv) => ({
              id: inv.id,
              company_id: 1,
              created_at: inv.createdAt,
              direction: "in",
            })),
            count: fakePdpInbox.length,
            has_before: false,
            has_after: false,
          }),
        );
        return;
      }

      const fileMatch = url.pathname.match(/^\/v1\.beta\/invoices\/(\d+)$/);
      if (req.method === "GET" && fileMatch && url.searchParams.get("format") === "original") {
        const invoice = fakePdpInbox.find((inv) => String(inv.id) === fileMatch[1]);
        if (!invoice) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ http_status_code: 404 }));
          return;
        }
        const bytes = readFileSync(join(__dirname, "cypress/fixtures", invoice.fixturePath));
        res.writeHead(200, { "Content-Type": invoice.contentType });
        res.end(bytes);
        return;
      }

      const lifecycleMatch = url.pathname.match(/^\/v1\.beta\/invoices\/(\d+)\/lifecycle_events$/);
      if (req.method === "POST" && lifecycleMatch) {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            fakePdpLifecycleEvents.push({ invoiceId: lifecycleMatch[1], code: body.code });
          } catch {
            // A malformed push body is itself not this fake's concern to validate — the real
            // pdp-client.ts already shapes this request; this fake only records what arrived.
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({}));
        });
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ http_status_code: 404 }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      fakePdpServerUrl = `http://127.0.0.1:${address.port}`;
      resolve(fakePdpServerUrl);
    });
  });
}

/**
 * Enqueues ONE REAL `document-pdp-reception-sweep` job on the SAME BullMQ queue
 * (`document-action`) the backend's own repeatable uses (`document-queue.dispatcher.ts`'s
 * `registerPdpReceptionSweepRepeatable`) — the backend under test's own, already-running
 * `DocumentActionProcessor` picks it up and runs the REAL `PdpReceptionSweepRunner.runSweep()`,
 * exactly as it would on the repeatable's own schedule. Triggered on demand instead of waiting on
 * that interval (a production default of 5 minutes — `reception-sweep.ts`'s own header) for the SAME
 * reason `DOCUMENT_SCHEDULE_SWEEP_INTERVAL_MS`/`DOCUMENT_CONFORMITY_SWEEP_INTERVAL_MS` are lowered in
 * `backend/.env.test` for their own sweeps — except here as a fresh one-off job from THIS Node
 * process rather than an env-var-lowered interval, since the backend under test may already be
 * running (this harness's own "use :4000 if it already responds" convention) with no guarantee its
 * own process re-read a freshly-lowered interval. A short, fixed jobId (timestamp-suffixed) avoids
 * colliding with the real repeatable's own `document-pdp-reception-sweep-singleton` id.
 */
async function triggerPdpReceptionSweep(): Promise<null> {
  const connection = { url: process.env.REDIS_URL || "redis://localhost:6399" };
  const queue = new Queue("document-action", { connection });
  try {
    await queue.add(
      "document-pdp-reception-sweep",
      {},
      { jobId: `e2e-reception-sweep-${Date.now()}`, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
  } finally {
    await queue.close();
  }
  return null;
}

/**
 * `48-payment-qr.cy.ts`'s own SEPA/EPC069-12 QR content proof. The old version of that spec measured
 * PDF SIZE only — its own header used to claim "a QR inside a binary PDF cannot be decoded from
 * Cypress" — which stayed green whether the QR carried the right IBAN/amount/reference, the wrong
 * ones, or (bar a byte-count coincidence) none at all. That claim turned out to be false: Chromium's
 * own `page.pdf()` (`render-pdf.ts`) keeps the `<img>` the QR is embedded as a REAL, separate
 * `/XObject /Subtype /Image` stream rather than flattening the whole page into one bitmap — verified
 * by hand against a real invoice PDF from this exact pipeline before writing this task. `pdf-lib`
 * walks the page's own `/Resources /XObject` dictionary to find it (no HTML/page rasterization
 * needed at all), `decodePDFRawStream` undoes whatever `/Filter` Chromium's writer used
 * (FlateDecode, observed), and the result is a plain RGB8 raster (`qrcode`'s own PNG, re-encoded by
 * Chromium as an uncompressed image sample) — expanded to RGBA (jsQR's own required shape) and handed
 * to `jsQR`. Runs in THIS process for the SAME reason `extractPdfText` above does: `pdf-lib`/`jsqr`
 * need a real Node, not a Cypress spec running inside Electron/Firefox; the caller sends the PDF as
 * base64 for the same JSON-serializable-arguments reason `extractPdfText` already documents.
 *
 * Returns the decoded string of EVERY image XObject that IS a valid QR (never just the first) — a
 * document with a company logo configured would carry a SECOND image, and the caller can tell them
 * apart by content (the SEPA payload always starts "BCD\n002") without this task guessing which one
 * is "the" QR. An invoice with no QR embedded (no IBAN, or a non-EUR currency) legitimately returns
 * an empty array — a genuine finding for the caller's own "absent" assertions, not an error.
 */
async function decodeSepaQrFromPdf(base64: string): Promise<string[]> {
  const bytes = Buffer.from(base64, "base64");
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const decoded: string[] = [];
  for (const page of pdfDoc.getPages()) {
    const resources = page.node.Resources();
    if (!resources) continue;
    const xObjects = resources.lookup(PDFName.of("XObject"));
    if (!(xObjects instanceof PDFDict)) continue;
    for (const key of xObjects.keys()) {
      const xObject = xObjects.lookup(key);
      if (!(xObject instanceof PDFRawStream)) continue;
      const subtype = xObject.dict.lookup(PDFName.of("Subtype"));
      if (!subtype || subtype.toString() !== "/Image") continue;
      const width = Number(xObject.dict.lookup(PDFName.of("Width"))?.toString());
      const height = Number(xObject.dict.lookup(PDFName.of("Height"))?.toString());
      if (!width || !height) continue;
      const raw = decodePDFRawStream(xObject).decode();
      // Observed shape for THIS pipeline's own QR: plain RGB8, no color-space indirection to resolve
      // here — a stream that doesn't fit that exact byte count is some OTHER kind of image (the
      // company's own logo, e.g. a JPEG `/DCTDecode` this task does not attempt to decompress) and is
      // simply skipped, not misread as a QR.
      if (raw.length !== width * height * 3) continue;
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
        rgba[j] = raw[i];
        rgba[j + 1] = raw[i + 1];
        rgba[j + 2] = raw[i + 2];
        rgba[j + 3] = 255;
      }
      const result = jsQR(rgba, width, height);
      if (result?.data) decoded.push(result.data);
    }
  }
  return decoded;
}

/**
 * `33-signing-certificates.cy.ts`'s own PAdES ByteRange proof. Checking for the substrings
 * `/ByteRange` and `/Contents` (the OLD version of that spec) proves a signature dictionary was
 * WRITTEN, never that it covers what it claims to, or that the bytes it covers are even real: a PDF
 * modified AFTER signing (a watermark, a metadata edit) keeps both substrings while invalidating the
 * signature every real PDF viewer would reject it for. This performs the REAL check instead — the
 * "real control" the backend's own CAdES jest test already applies via `pkijs` (`signing/
 * providers.spec.ts`'s "PKCS#7 envelope verifies with pkijs"), here for PAdES's DETACHED signature
 * shape (the signed bytes are the PDF's own `/ByteRange` slices, never embedded in the PKCS7 blob
 * itself, unlike CAdES's enveloping one):
 *
 *  1. `@signpdf/utils#extractSignature` — the SAME extraction the backend's own jest specs already
 *     use (`signing/providers.spec.ts`, `sign-instance-pdf.spec.ts`) — reads `/ByteRange` and slices
 *     the REAL PDF bytes it names into `signedData`, and the raw PKCS7 DER out of `/Contents`.
 *  2. `asn1js`/`pkijs` parse that DER into a `SignedData` structure exactly like `providers.spec.ts`'s
 *     own CAdES test already does.
 *  3. `signedData.verify({ data: <the ByteRange-sliced bytes> })` is what actually PROVES coverage:
 *     for a DETACHED signature, this recomputes the digest over the SUPPLIED `data`, compares it
 *     against the `messageDigest` the signer committed to, and verifies the RSA signature over the
 *     signed attributes — three real cryptographic facts a byte-tamper (or a `/ByteRange` that quietly
 *     excludes some of the file) breaks, and a substring check cannot see at all. Verified by hand
 *     against a real signed invoice from this exact pipeline before writing this task: flipping one
 *     byte inside the covered range turns `signatureVerified` false (a real
 *     `SignedDataVerifyError`, "Message digest doesn't match"), confirming the check is live, not
 *     tautological.
 *
 * `byteRangeCoversWholeFile` is the SEPARATE, complementary fact `signatureVerified` alone does not
 * establish: that `/ByteRange` itself spans the ENTIRE file minus only the `/Contents` hex placeholder
 * (starts at byte 0, ends at the file's own last byte) — a signature that is cryptographically valid
 * over a SHORTER range (leaving unsigned trailer bytes a tool could still append to) would pass (3)
 * above yet still be a weaker guarantee than "the whole file, once signed, cannot change at all".
 */
async function verifyPadesSignatureCoverage(base64: string): Promise<{
  signatureVerified: boolean;
  byteRangeCoversWholeFile: boolean;
  byteRange: number[];
}> {
  const bytes = Buffer.from(base64, "base64");
  const { ByteRange, signature, signedData } = extractSignature(bytes) as {
    ByteRange: number[];
    signature: string;
    signedData: Buffer;
  };

  const byteRangeCoversWholeFile = ByteRange[0] === 0 && ByteRange[2] + ByteRange[3] === bytes.length;

  const derBuffer = Buffer.from(signature, "binary");
  const asn1Object = asn1js.fromBER(
    derBuffer.buffer.slice(derBuffer.byteOffset, derBuffer.byteOffset + derBuffer.byteLength),
  );
  const contentInfo = new pkijs.ContentInfo({ schema: asn1Object.result });
  const signedDataObj = new pkijs.SignedData({ schema: contentInfo.content });
  // A FRESH, exactly-sized `ArrayBuffer` — `signedData.buffer` (Node's own `Buffer`, a `Uint8Array`
  // subclass) is typed `ArrayBufferLike` (`ArrayBuffer | SharedArrayBuffer`) and can also be a larger
  // pooled allocation than `signedData` itself views; `new Uint8Array(signedData)` copies into a
  // plain `Uint8Array` backed by a buffer of exactly `signedData.length`, which is what pkijs's own
  // `ArrayBuffer`-typed `data` param requires.
  const dataBuffer = new Uint8Array(signedData).buffer;

  let signatureVerified = false;
  try {
    const result = (await signedDataObj.verify({
      signer: 0,
      checkChain: false,
      extendedMode: true,
      data: dataBuffer,
    })) as pkijs.SignedDataVerifyResult;
    signatureVerified = result.signatureVerified === true;
  } catch {
    // `extendedMode` still throws for a digest mismatch (verified by hand — see this function's own
    // header) rather than resolving with `signatureVerified: false` — caught here so a genuinely
    // broken signature is reported to the CALLER as a normal, assertable `false`, never an opaque
    // task-crashed error.
    signatureVerified = false;
  }

  return { signatureVerified, byteRangeCoversWholeFile, byteRange: ByteRange };
}

export default defineConfig({
  // The suite runs 15 specs back to back in one CI job with video capture on, which
  // grows the Electron renderer's heap until it crashes ("Renderer process just
  // crashed", seen on 14-articles). Both settings below are Cypress' own remedy:
  // release each spec's memory instead of keeping every test's DOM snapshots around.
  experimentalMemoryManagement: true,
  numTestsKeptInMemory: 0,
  //
  // Those two settings are NOT enough, and the record should say so rather than leave the next
  // person to re-derive it. With both enabled, the Electron renderer still crashes intermittently:
  // measured across eight runs it hit 17-invoice-rejection, 08-payments and 10-recurring-invoices,
  // at position 2 of 17 as readily as at position 17, and in a three-spec run as readily as a
  // seventeen-spec one. Instrumenting the spec through a Node-side task — the browser console dies
  // with the renderer — put the crash at one exact step: clicking the first option of a Radix
  // select inside a dialog. Same step, three different specs.
  //
  // The same suite on FIREFOX passes: 17/17, including 17-invoice-rejection, which had never once
  // been green under Electron. So this is an Electron/Chromium-headless problem with Radix's
  // select, not a memory budget and not a defect in the specs. Running e2e on Firefox is the known
  // workaround:  ./scripts/e2e-worktree.sh --browser firefox
  //
  // CI now runs FIREFOX for exactly this reason — `.github/workflows/cypress.yml` and
  // `scenarios.yml` both pass `--browser firefox`. Measured 2026-09-12: 18-onboarding-wizard,
  // 25-document-settlement and 29-document-recurrence crash the Electron renderer even when each
  // is run ALONE in a fresh process, and all four of the specs that were red under Electron pass
  // on Firefox 154 with zero renderer crashes.
  //
  // `npm run e2e:run` therefore passes `--browser firefox` itself. It used to leave Electron as the
  // default, which meant the one command a developer actually types could never go green: measured
  // 2026-09-13, a full 48-spec battery on Electron lost 14-articles, 18-onboarding-wizard,
  // 25-document-settlement and 29-document-recurrence to renderer crashes -- the exact four named
  // above -- while the same specs pass on Firefox. A default that cannot be green teaches people to
  // ignore the suite. Pass `--browser electron` explicitly if you want to reproduce the crash.
  e2e: {
    video: true,
    baseUrl: process.env.FRONTEND_URL || "http://localhost:6284",
    specPattern: "cypress/e2e/**/*.cy.{js,ts}",
    supportFile: "cypress/support/e2e.ts",
    env: {
      apiUrl: process.env.VITE_BACKEND_URL || "http://localhost:4000",
    },
    setupNodeEvents(on) {
      on("task", {
        /**
         * Print a step to the RUNNER's stdout, not the browser console.
         *
         * 17-invoice-rejection crashes the Electron renderer partway through its first test, and a
         * crashed renderer takes its console with it — which is why five runs produced the same
         * eleven-line "we detected that the renderer crashed" and nothing about where. A task runs
         * in the Node process, so whatever it printed before the crash survives in the run log.
         */
        logStep(message: string) {
          // eslint-disable-next-line no-console
          console.log(`[step ${new Date().toISOString().slice(11, 23)}] ${message}`);
          return null;
        },
        // `prisma migrate reset --force` used to run here, but it DROPS and recreates
        // the whole schema while the backend is still running and holding pooled
        // connections — the backend's own logger writes to `Log` on every request, so
        // that drop raced with in-flight queries and broke every spec at the auth step
        // (Postgres logged `relation "public.Log" does not exist`). Truncating the
        // existing tables clears the data without ever touching the schema.
        async resetDatabase() {
          const client = new Client({
            connectionString:
              process.env.DATABASE_URL ||
              "postgresql://invoicerr:invoicerr@localhost:5433/invoicerr_db?schema=public",
          });
          await client.connect();
          // No catch below on purpose: a failed reset must throw and fail the spec
          // loudly instead of returning null and surfacing as a confusing error later.
          // The `finally` only guarantees the connection is closed either way.
          try {
            // Read the table list from Postgres instead of hardcoding it so this
            // doesn't silently drift when the Prisma schema gains new models.
            //
            // `DocumentCountryActionRule`, `CountryIdentifierRequirement`, and `B2gRoutingRule` are
            // excluded on purpose, alongside `_prisma_migrations`: all three are REFERENCE data
            // mirrored from backend/src/modules/documents/{country-policy,country-identifiers,
            // b2g-routing}/data/*.json, never per-spec fixture data a test creates and expects
            // wiped. Truncating any of them here would leave the backend running EMPTY until the
            // next reseed: `DocumentCountryActionRule` empty means "a country with no policy rows
            // blocks every document action" (country-policy.ts) — a 403 on every document action in
            // every later spec; `CountryIdentifierRequirement` empty means every country looks like
            // it has NO identifier-requirements file at all (country-identifiers.ts) — the
            // client/company/onboarding identifier fields this task exists to keep visible would
            // silently stop rendering for the rest of the run; `B2gRoutingRule` empty means every
            // government client looks like it has no B2G rule at all (`40-b2g-routing.cy.ts` is the
            // one spec that reads it).
            //
            // HISTORY: until the "seed drift" fix, `DocumentCountryActionRule` and
            // `CountryIdentifierRequirement` were seeded ONLY at migration time
            // (`seedCountryPolicies()`/`seedCountryIdentifierRequirements()` from `prisma/seed.ts`'s
            // `migrations.seed` hook — see prisma.config.ts) — a JSON-only edit to
            // `country-policy/data/*.json` reached neither an already-migrated e2e database nor a
            // simply-restarted dev backend without someone remembering to run `prisma db seed` by
            // hand, and silently 403'd every document action in the meantime (the bug this fix closed:
            // "`resetAndSeed` ne re-sème pas la politique pays"). `B2gRoutingRule` never had that
            // problem: it was always upserted at BACKEND BOOT (`B2gRoutingBootUpsertService`, an
            // `OnModuleInit` — see `schema.prisma`'s own comment on that model). Both other tables
            // now share that EXACT mechanism (`CountryPolicyBootReseedService` /
            // `CountryIdentifierRequirementsBootReseedService`, registered in
            // `documents-core.module.ts` next to `B2gRoutingBootUpsertService` — see each service's
            // own header for the drift-detect-then-reseed logic), so all three tables are excluded
            // from truncation for the SAME reason now: the backend process behind this e2e run
            // booted ONCE, before this task ever runs, and stays running for the whole suite —
            // truncating any of them here would leave it EMPTY until a full backend restart, which
            // nothing in a Cypress run ever triggers. `resetDatabase` no longer needs to TRIGGER a
            // reseed itself (the backend's own boot already did it, unconditionally, before the
            // suite started) — it VERIFIES one actually happened, right below, instead of quietly
            // trusting it and letting a real gap resurface as the exact silent 403 this fix exists
            // to prevent.
            const { rows } = await client.query(
              `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
                 AND tablename NOT IN ('_prisma_migrations', 'DocumentCountryActionRule', 'CountryIdentifierRequirement', 'B2gRoutingRule')`,
            );
            if (rows.length > 0) {
              const tables = rows.map((row: { tablename: string }) => `"${row.tablename}"`).join(", ");
              // RESTART IDENTITY resets serial/identity sequences back to their seed;
              // CASCADE follows foreign keys so table order doesn't matter.
              await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`);
            }

            // Verification, not re-triggering: see the HISTORY note above for why re-seeding from
            // HERE would be the wrong fix (the backend already did it once, at boot, before this
            // suite even started, and stays running the whole run — a second reseed from this Node
            // process would just duplicate logic that already lives in TypeScript on the backend
            // side). An empty reference table at this point means the backend's own boot-time
            // reseed either never ran or failed — exactly the silent-403 failure mode this whole
            // mechanism exists to turn loud, so this throws by name rather than let the next spec
            // discover it as an unexplained 403.
            for (const table of ["DocumentCountryActionRule", "CountryIdentifierRequirement", "B2gRoutingRule"]) {
              const { rows: countRows } = await client.query(`SELECT count(*)::int AS count FROM "${table}"`);
              if (countRows[0].count === 0) {
                throw new Error(
                  `resetDatabase: "${table}" is empty after reset — the backend's boot-time reseed ` +
                    "either hasn't run yet or failed. Every document action will 403 for the rest of " +
                    "this run until the backend under test is (re)started with a working reseed.",
                );
              }
            }
            return null;
          } finally {
            await client.end();
          }
        },

        // `failLastInvoice` and `complianceRefs` used to live here — Node-side helpers for the OLD
        // compliance engine (`ComplianceDocument`, `ComplianceEvent`, `ScheduledJob`,
        // `ComplianceCallbackRegistration`, `ComplianceAuthorityId`), all removed wholesale in
        // `fffbae77` ("refactor!: suppression des documents légaux et du moteur de conformité" — see
        // CLAUDE.md's "documents module" section). No spec called either task — the models don't
        // exist in `schema.prisma` any more, so a first call would have failed on
        // `relation "ComplianceDocument" does not exist` rather than doing what their own comments
        // described. Removed rather than ported: what replaced the old engine has no single
        // "compliance document" row to read back at all (about a dozen independent catalogs instead —
        // see CLAUDE.md), so there is no equivalent task to write in their place today.

        /**
         * Online payment ("paiement en ligne") — `60-online-payment.cy.ts`'s ONE piece of
         * Node-side help: a real `Stripe-Signature` header, computed exactly the way the backend's own
         * `stripe-signature.ts#verifyStripeSignature` verifies one (HMAC-SHA256 over
         * `${timestamp}.${payload}`), using node's own `crypto` — the browser has no `node:crypto`, and
         * `crypto.subtle` is async/awkward to thread through a Cypress command chain for what is
         * otherwise a one-line HMAC. This is NOT a shortcut around the real check: the backend still
         * runs its own, real `verifyStripeSignature` against whatever this produces — this task only
         * stands in for "a real Stripe server signing a real payload with the secret this company
         * configured", the one thing this offline suite cannot literally be.
         */
        stripeWebhookSignature({ payload, secret, timestampSeconds }: { payload: string; secret: string; timestampSeconds: number }) {
          const hmac = createHmac("sha256", secret).update(`${timestampSeconds}.${payload}`).digest("hex");
          return `t=${timestampSeconds},v1=${hmac}`;
        },

        // See this file's own header just above for why a real
        // `node:http` server, not a `cy.intercept`, is what a server-to-server webhook needs.
        startWebhookReceiver() {
          return startWebhookReceiver();
        },
        getWebhookRequests() {
          return [...receivedWebhookRequests];
        },
        clearWebhookRequests() {
          receivedWebhookRequests.length = 0;
          return null;
        },

        // See this file's own header just above ("PDP sandbox side") for why a real `node:http`
        // server, not a `cy.intercept`, is what the backend's own server-to-server PDP calls need.
        startFakePdpServer() {
          return startFakePdpServer();
        },
        setFakePdpInbox(invoices: FakePdpInboundInvoice[]) {
          fakePdpInbox = invoices;
          return null;
        },
        getFakePdpLifecycleEvents() {
          return [...fakePdpLifecycleEvents];
        },
        getFakePdpListCallCount() {
          return fakePdpListCallCount;
        },
        resetFakePdpServer() {
          fakePdpInbox = [];
          fakePdpLifecycleEvents.length = 0;
          fakePdpListCallCount = 0;
          return null;
        },
        triggerPdpReceptionSweep() {
          return triggerPdpReceptionSweep();
        },

        /**
         * `75-legal-acceptance.cy.ts`'s ONE piece of Node-side help: backdates a user's
         * `LegalAcceptance` row to an arbitrary, deliberately STALE `contentHash` — the sign-in
         * re-acceptance interstitial (`pages/legal/accept.tsx`, redirected to from
         * `(app)/_layout.tsx`) only fires when a required document's CURRENT content hash (whatever
         * ships in `documentation/docs/legal/*.md` today, hashed by `legal-documents.ts` — decision
         * 2026-09-17: acceptance is keyed on the hash, not `version`, see `LegalAcceptance`'s own
         * schema comment) differs from what the user last accepted, and nothing this offline suite
         * controls can make the shipped document's own text hash backwards to a real prior one.
         * Writing the row directly, with an OBVIOUSLY-fake hash, is what lets the spec prove the
         * interstitial fires without waiting for an actual text change to land. `version` is still
         * written alongside it (display-only column, same as production) so the interstitial's own
         * "Version X — effective Y" line has something real to render.
         */
        async setStaleLegalAcceptance({
          email,
          slug,
          version,
        }: {
          email: string;
          slug: string;
          version: string;
        }) {
          const client = new Client({
            connectionString:
              process.env.DATABASE_URL ||
              "postgresql://invoicerr:invoicerr@localhost:5433/invoicerr_db?schema=public",
          });
          await client.connect();
          try {
            const { rows } = await client.query(`SELECT id FROM "user" WHERE email = $1`, [email]);
            if (rows.length === 0) throw new Error(`setStaleLegalAcceptance: no user found for ${email}`);
            const userId = rows[0].id as string;
            // DELETE first, not just INSERT: sign-up already wrote a row for this exact
            // (userId, slug) at TODAY's real content hash (backend's own `recordLegalAcceptance`) —
            // `getPendingAcceptanceSlugs` only asks "is there ANY row at the CURRENT hash", so a stale
            // row living ALONGSIDE that real one would change nothing. Removing the real one is what
            // actually simulates "this user accepted an older text before a new version shipped".
            await client.query(`DELETE FROM "legal_acceptance" WHERE "userId" = $1 AND "documentSlug" = $2`, [
              userId,
              slug,
            ]);
            // 64 hex chars, sha256-shaped, but not a hash of anything this repo has ever shipped —
            // guaranteed never to collide with a real `contentHash` no matter how the document's text
            // evolves.
            const staleHash = "0".repeat(63) + "1";
            await client.query(
              `INSERT INTO "legal_acceptance" (id, "userId", "documentSlug", version, "contentHash", "acceptedAt")
               VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now())`,
              [userId, slug, version, staleHash],
            );
            return null;
          } finally {
            await client.end();
          }
        },

        /**
         * `76-seats.cy.ts`'s ONE piece of Node-side help: sets a company's own BOUGHT seat quantity
         * directly — the same "write the row a real event would otherwise set" shape
         * `setStaleLegalAcceptance` already uses for `LegalAcceptance` rows, here standing in for a
         * real Polar `subscription.updated` webhook or `seat-reconcile.ts`'s own SDK read (see
         * `backend/src/modules/billing/seat-sync.ts`'s own header: this app never pushes a seat count
         * to Polar, only reads one — this task is the offline suite's substitute for that read).
         * Resolves the company via its OWNER's email rather than needing a companyId threaded through
         * the whole spec, the same "resolve by email" convention `setStaleLegalAcceptance` holds.
         */
        async setCompanySubscriptionSeats({ email, seats }: { email: string; seats: number }) {
          const client = new Client({
            connectionString:
              process.env.DATABASE_URL ||
              "postgresql://invoicerr:invoicerr@localhost:5433/invoicerr_db?schema=public",
          });
          await client.connect();
          try {
            const { rows } = await client.query(
              `SELECT uc."companyId" AS "companyId"
               FROM "user" u
               JOIN "user_company" uc ON uc."userId" = u.id
               WHERE u.email = $1 AND uc.role = 'OWNER'
               ORDER BY uc."createdAt" ASC
               LIMIT 1`,
              [email],
            );
            if (rows.length === 0) {
              throw new Error(`setCompanySubscriptionSeats: no OWNER company found for ${email}`);
            }
            const companyId = rows[0].companyId as string;
            // Upsert: this spec's very first call may race the lazy row creation
            // (`getOrCreateCompanySubscription`) that only actually happens once billing is first
            // touched for this company — never assume the row already exists.
            await client.query(
              `INSERT INTO "company_subscription"
                 (id, "companyId", status, "trialStartedAt", "trialEndsAt", seats, "createdAt", "updatedAt")
               VALUES (gen_random_uuid()::text, $1, 'TRIAL', now(), now() + interval '14 days', $2, now(), now())
               ON CONFLICT ("companyId") DO UPDATE SET seats = EXCLUDED.seats, "updatedAt" = now()`,
              [companyId, seats],
            );
            return null;
          } finally {
            await client.end();
          }
        },

        /**
         * `20-document-totals.cy.ts`'s own PDF-content proof. A rendered invoice/quote PDF is
         * FlateDecode-compressed (Chromium's own PDF writer), so the string "Totals" almost never
         * appears verbatim in the raw bytes — a spec that fell back to "the file got bigger" on a miss
         * stayed green whether the totals block rendered the right numbers, the wrong numbers, or (bar
         * a length coincidence) no numbers at all. Runs in THIS process, not the browser: `pdf-parse`
         * (built on Mozilla's own `pdf.js`) needs a real filesystem/zlib-capable Node, which a Cypress
         * spec running inside Electron/Firefox is not — the same reason `resetDatabase`/`pg` above run
         * here rather than in the spec. Cypress tasks only accept JSON-serializable arguments, so the
         * caller sends the PDF as base64 (`Cypress.Buffer` on its side) rather than a raw Buffer.
         */
        async extractPdfText(base64: string): Promise<string> {
          const buffer = Buffer.from(base64, "base64");
          const parsed = await pdfParse(buffer);
          return parsed.text;
        },

        // See this file's own header just above ("SEPA/EPC069-12 QR content proof") for why this
        // decodes the PDF's own embedded image XObject rather than trusting a byte-count delta.
        decodeSepaQrFromPdf(base64: string) {
          return decodeSepaQrFromPdf(base64);
        },

        // See this file's own header just above ("PAdES ByteRange proof") for why this cryptographically
        // verifies the signature over the real ByteRange bytes rather than checking for two substrings.
        verifyPadesSignatureCoverage(base64: string) {
          return verifyPadesSignatureCoverage(base64);
        },
      });
    },
  }
});
