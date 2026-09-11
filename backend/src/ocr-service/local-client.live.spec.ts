/**
 * REAL round-trip against the LOCAL OCR engine this task chose — OUR OWN image, built + published
 * from its own repo `invoicerr-app/ocr-image` (`ghcr.io/invoicerr-app/ocr-image`). This spec PULLS
 * that published image and runs it itself (never a pre-existing service the operator must remember
 * to start) — MANDANT DECISION (verbatim): "pour l'OCR on peut faire notre propre image et notre
 * propre serveur: FROM jbarlow83/ocrmypdf:latest + RUN apt-get install tesseract-ocr-{ita,nld,rus,
 * equ}…", replacing the earlier `apache/tika:latest-full` this same spec used to launch (Tika's own
 * disqualifying limit — a language set frozen at build time — is exactly what motivated building our
 * own image instead; see `local-client.ts`'s own header and the `ocr-image` repo for the full account).
 *
 * Gated `LOCAL_OCR_LIVE=1` (`../modules/documents/transports/live-gate.ts`, same shape every
 * sibling live spec uses) — deliberately with NO required credential env var: that is the entire
 * point of this engine. The one thing this spec DOES need is a working local Docker daemon, checked
 * for at load time (`docker info`) — if the flag is set but Docker is not usable here, this suite
 * is SKIPPED with a one-line stderr warning, the exact same "flag on, requirement missing" outcome
 * `liveDescribe` already gives for a missing credential.
 *
 *   LOCAL_OCR_LIVE=1 npx jest local-client.live --no-coverage --forceExit
 *
 * VERIFIED, LIVE, in the OCR build task's own sandbox: a `docker build` of the `ocr-image` sources + `docker run` +
 * a real `POST /ocr` against a genuinely RASTERIZED (image-only, no text layer) invoice PDF, in BOTH
 * English/French and Polish, came back with the full, correctly-recognized invoice text — real
 * Tesseract OCR, not merely a text-layer read, proving both the engine swap and the new language
 * packs this Dockerfile adds over Tika's own frozen set. That exact manual round-trip is what this
 * task's own final report cites verbatim; THIS spec proves the same image + this client's own HTTP
 * wiring + the heuristic mapping, all together, automatically, on every `LOCAL_OCR_LIVE=1` run.
 *
 * An IMPROVEMENT over this spec's own former Tika-era limit, stated honestly because it changed:
 * the Tika version of this file could only prove its own HTTP round-trip with a `pdf-lib`-drawn
 * TEXT PDF, because Tika's fast path (PDFBox's native text extraction) would answer that WITHOUT
 * ever invoking Tesseract — real OCR accuracy needed a separate, manual, non-automated proof. This
 * engine's server always runs `ocrmypdf --force-ocr` (see `server.py`'s own header for why), which
 * rasterizes and OCRs EVERY page regardless of whether it already had text — so the exact same
 * `pdf-lib`-drawn PDF below now DOES exercise real Tesseract recognition, automatically, every time
 * this spec runs. No separate manual proof is required for THIS spec's own claim anymore (a
 * separate, genuinely rasterized-image round-trip was still run manually for this task's own
 * language-pack coverage claim — see the report this task produced — since building a checked-in
 * binary image fixture would not travel through a jest spec file as legibly as drawn text does).
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { PDFDocument } from 'pdf-lib';

import { liveDescribe } from '../modules/documents/transports/live-gate';
import { buildLocalOcrClient } from './local-client';

// The OCR image lives in its OWN repo (github.com/invoicerr-app/ocr-image) and is published to GHCR —
// this spec PULLS the published image rather than building one from this repo.
const LOCAL_OCR_IMAGE = 'ghcr.io/invoicerr-app/ocr-image:latest';

/** `docker info` (never just `docker --version`) — the daemon must actually be reachable, not
 *  merely the CLI present, for `docker build`/`docker run` below to have any chance of working. */
function isDockerUsable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const flagDescribe = liveDescribe('LOCAL_OCR_LIVE');
const dockerUsable = flagDescribe === describe ? isDockerUsable() : false;
if (flagDescribe === describe && !dockerUsable) {
  process.stderr.write(
    '[live-gate] LOCAL_OCR_LIVE=1 but `docker info` failed (no usable Docker daemon in this ' +
      'environment) — suite will be skipped.\n',
  );
}
const describeLive = flagDescribe === describe && dockerUsable ? describe : describe.skip;

describeLive('Local OCR engine (the ocr-image repo, ocrmypdf-based) — real image, real round-trip', () => {
  const containerName = `invoicerr-local-ocr-live-${randomUUID().slice(0, 8)}`;
  let localOcrUrl: string;

  beforeAll(async () => {
    // Pulled from GHCR — the image is built + published by its own repo's CI
    // (github.com/invoicerr-app/ocr-image). Docker's layer cache makes re-runs near-instant.
    execFileSync('docker', ['pull', LOCAL_OCR_IMAGE], { timeout: 300_000 });

    // `-P`: publish every EXPOSEd port (9998) to a random free host port — never a hard-coded port
    // this test could collide with a port already in use on the machine running it.
    execFileSync('docker', ['run', '-d', '--rm', '-P', '--name', containerName, LOCAL_OCR_IMAGE], {
      timeout: 30_000,
    });

    const portMapping = execFileSync('docker', ['port', containerName, '9998/tcp'], {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
    const port = portMapping.split(':').pop();
    if (!port) throw new Error(`could not determine the published port from "${portMapping}"`);
    localOcrUrl = `http://127.0.0.1:${port}`;

    // This server answers `/health` the instant the process is listening (no JVM-style warmup the
    // way Tika's own container needed) — still polled rather than assumed ready, the same
    // "never a fixed sleep" discipline this spec always held.
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        const res = await fetch(`${localOcrUrl}/health`);
        if (res.ok) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error(`${LOCAL_OCR_IMAGE} never became ready at ${localOcrUrl}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }, 330_000);

  afterAll(() => {
    try {
      execFileSync('docker', ['rm', '-f', containerName], { stdio: 'ignore', timeout: 15_000 });
    } catch {
      // best-effort cleanup — `--rm` above already removes it on its own once stopped
    }
  });

  it('extracts a real invoice PDF, end to end, through the real container, and maps the heuristic fields', async () => {
    // A REAL PDF, built with this backend's own `pdf-lib` dependency (never a hand-crafted binary
    // fixture) — the SAME "never a hand-crafted binary fixture" discipline
    // `mistral-client.live.spec.ts` already holds one file up. Unlike the Tika era, this DOES
    // exercise real Tesseract recognition — see this file's own header on why `--force-ocr` changed
    // that.
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const lines = [
      'ACME LIVE TEST SUPPLIER SARL',
      'FACTURE N. LIVE-2026-0099',
      "Date d'emission: 2026-09-05",
      'TVA: FR99999999999',
      'Total HT: 300.00 EUR',
      'Total TVA: 60.00 EUR',
      'Total TTC: 360.00 EUR',
    ];
    lines.forEach((line, i) => {
      page.drawText(line, { x: 20, y: 260 - i * 20, size: 12 });
    });
    const pdfBytes = await doc.save();

    const client = buildLocalOcrClient({ baseUrl: localOcrUrl });
    const proposal = await client.extract(pdfBytes, 'application/pdf');

    // Not asserted against every field with equal confidence (real-world OCR can shift token order
    // at the edges) — but the three totals and the VAT id are unambiguous, keyword-anchored matches
    // this heuristic is specifically built to get right.
    expect(proposal.fields.netAmount).toBe(300);
    expect(proposal.fields.vatAmount).toBe(60);
    expect(proposal.fields.grossAmount).toBe(360);
    expect(proposal.fields.supplierVatId).toBe('FR99999999999');
  }, 60_000);
});
