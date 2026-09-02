/**
 * REAL round-trip against the PISTE sandbox — gated `CHORUSPRO_LIVE=1` + `CHORUSPRO_CLIENT_ID` /
 * `CHORUSPRO_CLIENT_SECRET` (`live-gate.ts`, the same shape every sibling `*.live.spec.ts` in this
 * module uses). `CHORUSPRO_TECH_LOGIN`/`CHORUSPRO_TECH_PASSWORD` are read too but NOT part of the
 * gate's required list — same asymmetry the repère's own `choruspro-live.spec.ts` held: a PISTE OAuth
 * application can exist (and be worth proving reachable) before a Chorus Pro compte technique has
 * been created for it, so this spec still runs the OAuth half and SKIPS only the deposit half when the
 * technical-account pair is absent, rather than gating the whole file on all four.
 *
 * HONEST STATUS AT THE END OF THIS TASK: **skipped, always** — this checkout holds no PISTE account of
 * any kind (see `CREDENTIALS_GUIDE.md` §3, "Repo status: 🔴 missing", unchanged by this task). Nobody
 * has run this file's own `describeLive` block for real. What IS independently verified, live, THIS
 * task (2026-09-02, recorded in `choruspro-client.ts`'s own header): the OAuth endpoint this spec would
 * hit (`https://sandbox-oauth.piste.gouv.fr/api/oauth/token`) is reachable and answers a genuine
 * `HTTP 400 {"error":"invalid_client"}` for a garbage client_id/secret — proof the HOST/PATH are
 * correct, never a claim that a real PISTE application's own credentials would succeed here (that
 * needs the account this task does not have). Do not read a future green run of THIS file as more than
 * what it actually checks — see this module's own README-level discipline (`LIVE_TESTING.md`, and the
 * project memory entry "KSeF mock tests = false confidence": a gated spec that passes with mocks proves
 * nothing about the integration).
 *
 * Recipe (mirrors `../pdp/pdp.live.spec.ts`'s own DB-free approach — the exact bridge
 * `chorus-pro-transport.ts#send()` composes, called here by hand so this spec never needs a live DB):
 *   buildInvoiceDescriptor + computeDocumentTotals → buildSemanticInvoice → newEuInvoiceService()
 *     .generate(..., 'CII') → splitCiiIncludedNotes → validateStructural + validateSchematron (the
 *     EXACT gate `facturx-provider.ts` runs) → newEuInvoiceService().generate(..., 'Factur-X-EN16931')
 *     → ChorusProClient (REAL, `FetchChorusProHttpPort`) .deposerFlux() → .consulterCr().
 *
 * Run:
 *   cd backend && set -a; . .env.test.local; set +a
 *   CHORUSPRO_LIVE=1 npx jest choruspro-live --no-coverage --runInBand
 */
import { PDFDocument } from 'pdf-lib';

import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { buildSemanticInvoice, SemanticPartyInput } from '../../formats/semantic/build-semantic-invoice';
import { splitCiiIncludedNotes } from '../../formats/semantic/cii-post-process';
import { newEuInvoiceService } from '../../formats/shared-build';
import { validateStructural } from '../../formats/structural-check';
import { EN16931_CII_SCH, validateSchematron } from '../../formats/vendored/validate-schematron';
import { computeDocumentTotals } from '../../totals/compute-totals';
import { liveDescribe } from '../live-gate';
import { ChorusProClient, FetchChorusProHttpPort, mapChorusProStatus } from './choruspro-client';

const describeLive = liveDescribe('CHORUSPRO_LIVE', ['CHORUSPRO_CLIENT_ID', 'CHORUSPRO_CLIENT_SECRET']);

describeLive('Chorus Pro PISTE live round-trip', () => {
  it('authenticates against PISTE, and — when a compte technique is also configured — deposits a real Factur-X flux', async () => {
    const clientId = process.env.CHORUSPRO_CLIENT_ID!;
    const clientSecret = process.env.CHORUSPRO_CLIENT_SECRET!;
    const technicalAccountLogin = process.env.CHORUSPRO_TECH_LOGIN ?? '';
    const technicalAccountPassword = process.env.CHORUSPRO_TECH_PASSWORD ?? '';
    const isSandbox = (process.env.CHORUSPRO_ENVIRONMENT ?? 'SANDBOX').toUpperCase() !== 'PROD';

    const oauthBaseUrl = isSandbox ? 'https://sandbox-oauth.piste.gouv.fr' : 'https://oauth.piste.gouv.fr';
    const apiBaseUrl = isSandbox ? 'https://sandbox-api.piste.gouv.fr' : 'https://api.piste.gouv.fr';
    console.log('[choruspro-live] environment:', isSandbox ? 'SANDBOX' : 'PROD', oauthBaseUrl, apiBaseUrl);

    const client = new ChorusProClient(
      { oauthBaseUrl, apiBaseUrl, clientId, clientSecret, technicalAccountLogin, technicalAccountPassword },
      new FetchChorusProHttpPort(),
    );

    // ── Step 1: authenticate — verifies the OAuth token endpoint is reachable and this application's
    // credentials are accepted (hard failure otherwise, never a soft `expect().toBeFalsy()`). ──
    const token = await client._getToken();
    if (!token) throw new Error('[choruspro-live] PISTE returned no access token — hard failure.');
    console.log('[choruspro-live] auth OK — token length:', token.length);
    expect(token.length).toBeGreaterThan(0);

    if (!technicalAccountLogin || !technicalAccountPassword) {
      console.warn(
        '[choruspro-live] CHORUSPRO_TECH_LOGIN / CHORUSPRO_TECH_PASSWORD not set — skipping deposerFlux ' +
          "(OAuth-only proof, see this file's own header).",
      );
      return;
    }

    // ── Step 2: build a REAL, EN 16931-valid Factur-X — the identical recipe
    // `chorus-pro-transport.ts#send()` runs via `facturxFormatProvider.build()`. ──
    const SELLER: SemanticPartyInput = {
      name: 'Fournisseur de Test SAS',
      address: '1 rue du Test',
      city: 'Paris',
      postalCode: '75001',
      country: 'France',
      email: 'seller@example.fr',
      partyIdentifiers: [{ scheme: 'LEGAL_ID', value: '123456789' }],
    };
    const BUYER: SemanticPartyInput = {
      name: 'Ministère du Test',
      address: '20 avenue de Ségur',
      city: 'Paris',
      postalCode: '75007',
      country: 'France',
      email: 'buyer@example.fr',
      partyIdentifiers: [{ scheme: 'LEGAL_ID', value: '98765432100022' }],
    };

    const descriptor = buildInvoiceDescriptor();
    const timestamp = Date.now();
    const data = {
      client: 'live-client',
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date().toISOString().slice(0, 10),
      currency: 'EUR',
      lines: [
        { description: 'Prestations de service', quantity: 1, unit: 'unit', unitPrice: 1000, vatRate: '20' },
      ],
    };
    const totals = computeDocumentTotals(descriptor, data);
    const euInvoice = buildSemanticInvoice({
      displayNumber: `INV-CPR-${timestamp}`,
      issueDate: data.issueDate,
      seller: SELLER,
      buyer: BUYER,
      lines: data.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
      })),
      totals,
    });

    const service = newEuInvoiceService();
    const rawCii = (await service.generate(euInvoice, { format: 'CII', lang: 'en' })) as string;
    const cii = splitCiiIncludedNotes(rawCii);
    const structural = validateStructural(cii, 'cii');
    if (!structural.valid) {
      throw new Error(`[choruspro-live] structural gate rejected the CII: ${structural.errors.join('; ')}`);
    }
    const schematron = validateSchematron(cii, EN16931_CII_SCH);
    if (!schematron.valid) {
      throw new Error(
        `[choruspro-live] EN 16931 Schematron gate rejected the CII: ` +
          schematron.errors.map((e) => `${e.id}: ${e.message}`).join('; '),
      );
    }

    const hostPdf = await PDFDocument.create();
    hostPdf.addPage([595, 842]);
    const hostPdfBytes = Buffer.from(await hostPdf.save());
    const facturxPdf = (await service.generate(euInvoice, {
      format: 'Factur-X-EN16931',
      pdf: { buffer: hostPdfBytes, filename: `INV-CPR-${timestamp}.pdf`, mimetype: 'application/pdf' },
      lang: 'en',
    })) as Uint8Array;
    expect(Buffer.from(facturxPdf.slice(0, 5)).toString()).toBe('%PDF-');

    // ── Step 3: the REAL deposit. ──
    const depositResult = await client.deposerFlux(
      Buffer.from(facturxPdf),
      `INV-CPR-${timestamp}.pdf`,
      'IN_DP_E3_FACTUR_X_10',
    );
    console.log('[choruspro-live] deposit result:', JSON.stringify(depositResult, null, 2));

    // HARD-SUCCESS CONTRACT (LIVE_TESTING.md) — an empty numeroFluxDepot is a hard failure, never a
    // soft assertion that could quietly pass on a shrugging response.
    if (!depositResult.numeroFluxDepot) {
      throw new Error(
        `[choruspro-live] no numeroFluxDepot returned — hard failure. Raw: ${JSON.stringify(depositResult)}`,
      );
    }
    expect(depositResult.numeroFluxDepot).not.toBe('');

    // ── Step 4: at least one consulterCr poll. ──
    const cr = await client.consulterCr(depositResult.numeroFluxDepot);
    console.log('[choruspro-live] consulterCr result:', JSON.stringify(cr, null, 2));
    const status = mapChorusProStatus(cr.statutFlux);
    if (status === 'REJECTED') {
      throw new Error(`[choruspro-live] consulterCr returned a REJECTED verdict: ${JSON.stringify(cr)}`);
    }
    expect(['PENDING', 'CLEARED']).toContain(status);
  }, 60_000);
});
