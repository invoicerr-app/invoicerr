/**
 * REAL round-trip against the LOCAL OCR engine this task chose — `apache/tika:latest-full`, a real
 * Docker container, LAUNCHED BY THIS SPEC ITSELF (never a pre-existing service the operator has to
 * remember to start first) — TODO_PRODUIT.md follow-up, mandant's own words: "J'ai pas de clé
 * Mistral, pour moi en local faut lancer un service Docker qui fait ça".
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
 * VERIFIED, LIVE, in THIS task's own sandbox (2026-09-05, `docker ps` confirmed a working daemon):
 * `docker pull apache/tika:latest-full` + `docker run` + a real `PUT /tika` against a genuinely
 * RASTERIZED (image-only, no text layer) invoice PDF came back with the full, correctly-recognized
 * invoice text — real Tesseract OCR, not merely a text-layer read. That exact manual round-trip is
 * what justified choosing Tika at all (see `local-client.ts`'s own header for the full account);
 * THIS spec proves the same container + this client's own HTTP wiring + the heuristic mapping, all
 * together, automatically, on every `LOCAL_OCR_LIVE=1` run.
 *
 * HONEST LIMIT of what THIS spec proves, stated up front: like `mistral-client.live.spec.ts` one
 * file up, the PDF built below is `pdf-lib`-drawn TEXT (a real, renderable text layer), not a
 * rasterized image — so Tika's fast path (PDFBox's own text extraction) answers this one WITHOUT
 * ever invoking its bundled Tesseract. This spec is therefore proof of the CONTAINER + the HTTP
 * round-trip + the heuristic mapping, not of Tesseract's OCR accuracy specifically — the identical,
 * already-documented trade-off the Mistral live spec makes for the identical reason (a checked-in
 * binary image fixture would not travel through a jest spec file as legibly as drawn text does).
 * The REAL Tesseract path was independently, manually verified instead (see this file's header
 * above) — never merely asserted here.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { PDFDocument } from 'pdf-lib';

import { liveDescribe } from '../modules/documents/transports/live-gate';
import { buildLocalOcrClient } from './local-client';

const LOCAL_OCR_IMAGE = 'apache/tika:latest-full';

/** `docker info` (never just `docker --version`) — the daemon must actually be reachable, not
 *  merely the CLI present, for `docker run` below to have any chance of working. */
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

describeLive('Local OCR engine (apache/tika:latest-full) — real container, real round-trip', () => {
  const containerName = `invoicerr-local-ocr-live-${randomUUID().slice(0, 8)}`;
  let localOcrUrl: string;

  beforeAll(async () => {
    // `-P`: publish every EXPOSEd port (9998) to a random free host port — never a hard-coded port
    // this test could collide with a port already in use on the machine running it.
    execFileSync(
      'docker',
      ['run', '-d', '--rm', '-P', '--name', containerName, LOCAL_OCR_IMAGE],
      { timeout: 120_000 }, // first run on a machine without the image cached: a real image pull
    );

    const portMapping = execFileSync('docker', ['port', containerName, '9998/tcp'], {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
    const port = portMapping.split(':').pop();
    if (!port) throw new Error(`could not determine the published port from "${portMapping}"`);
    localOcrUrl = `http://127.0.0.1:${port}`;

    // Tika's own JVM takes a few real seconds to start serving — poll `/tika` (200 once ready)
    // rather than a fixed sleep, which would be either too slow or too flaky depending on the host.
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const res = await fetch(`${localOcrUrl}/tika`);
        if (res.ok) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error(`${LOCAL_OCR_IMAGE} never became ready at ${localOcrUrl}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }, 130_000);

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
    // `mistral-client.live.spec.ts` already holds one file up; see this file's own header for the
    // honest trade-off that comes with drawn TEXT rather than a rasterized scan.
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

    // Not asserted against every field with equal confidence (real-world text-extraction layout
    // can shift token order at the edges) — but the three totals and the VAT id are unambiguous,
    // keyword-anchored matches this heuristic is specifically built to get right.
    expect(proposal.fields.netAmount).toBe(300);
    expect(proposal.fields.vatAmount).toBe(60);
    expect(proposal.fields.grossAmount).toBe(360);
    expect(proposal.fields.supplierVatId).toBe('FR99999999999');
  }, 30_000);
});
