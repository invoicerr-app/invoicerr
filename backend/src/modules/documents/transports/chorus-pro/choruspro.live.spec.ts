/**
 * REAL round-trip against the PISTE sandbox — gated `CHORUSPRO_LIVE=1` + `CHORUSPRO_CLIENT_ID` /
 * `CHORUSPRO_CLIENT_SECRET` (`live-gate.ts`, the same shape every sibling `*.live.spec.ts` in this
 * module uses). `CHORUSPRO_TECH_LOGIN`/`CHORUSPRO_TECH_PASSWORD` are read too but NOT part of the
 * gate's required list — same asymmetry the reference's own `choruspro-live.spec.ts` held: a PISTE OAuth
 * application can exist (and be worth proving reachable) before a Chorus Pro compte technique has
 * been created for it, so this spec still runs the OAuth half and SKIPS only the deposit half when the
 * technical-account pair is absent, rather than gating the whole file on all four.
 *
 * HONEST STATUS, and read the two halves separately — they are not equally proven.
 *
 * The OAuth half is **PROVEN LIVE, 2026-09-14**: run against a real PISTE sandbox application
 * (`APP_SANDBOX_…`, OAuth Credentials pair in `.env.test.local`), `client_credentials` returned a
 * genuine Bearer token, 54 characters, in 162 ms. That supersedes the weaker 2026-09-02 evidence
 * this header used to carry alone — that a garbage client_id/secret drew a real
 * `HTTP 400 {"error":"invalid_client"}`, which only ever proved the HOST/PATH were right. Real
 * credentials now demonstrably authenticate. Note PISTE answers that SAME `invalid_client` for an
 * unknown client_id and for a valid one with a wrong secret (measured, responses byte-identical), so
 * nothing short of a successful token proves a credential pair is good.
 *
 * The deposit half — `deposerFlux` + `consulterCr` — is **still unproven**: it needs a Chorus Pro
 * "compte technique" (`CHORUSPRO_TECH_LOGIN`/`_PASSWORD`), which this checkout does not have, so the
 * block below skips it and says so on stderr. A green run of this file therefore means "PISTE
 * authenticated us", NOT "we can file an invoice with Chorus Pro" — do not read the tick as more
 * than the log line under it. That distinction is this module's whole discipline
 * (`documentation/docs/developer-guide/live-testing.md`, and the project memory entry "KSeF mock
 * tests = false confidence").
 *
 * UPDATE 2026-09-14, a compte technique DID exist for one run: `deposerFlux` was ACCEPTED
 * (`numeroFluxDepot: CPP0011117000000000425895`, `statut: DEPOSE`, `codeRetour: 0`), but a LATER
 * `consulterCr()` poll (this client's own name for `consulterCRDetaille` — see `consulterCr()`'s own
 * doc comment) then reported `etatCourantDepotFlux: IN_REJETE` — Chorus Pro's own asynchronous
 * validation had not finished by the time this test's SINGLE, immediate poll below ran (still
 * `EN_COURS_DE_TRAITEMENT`/`PENDING` at that point, which is why this test's own assertion
 * `expect(['PENDING', 'CLEARED']).toContain(status)` legitimately passed even for the run that was
 * later found rejected — a real, structural blind spot of a single immediate poll, not a bug in the
 * assertion itself: a genuinely GREEN run of this file still does not, by itself, prove the deposit
 * clears — only a LATER poll (`chorus-pro-status-poller.ts`'s own job in production) can. Two
 * structured errors, both traced to real gaps in the hand-built fixture below, now fixed:
 * BT-81 (`SELLER.iban`, absent before this fix — see `sellerIban`'s own comment) and BT-23
 * (`businessProcessCodeOverride`, absent before this fix — see the `buildSemanticInvoice` call's own
 * comment). Both fixes also apply to the REAL production path (`chorus-pro-transport.ts`'s own new
 * "PAYMENT MEANS GATE" and its dedicated `facturxFormatProvider` instance,
 * `documents-core.module.ts`) — this spec's own fixture is kept a faithful, independent mirror of it,
 * per this file's own "DB-free approach" below. Not re-run against PISTE as part of establishing
 * this — the orchestrating session runs `CHORUSPRO_LIVE=1` next; until that run is green, read this
 * fix as "corrected against the documented root cause", not yet as "proven live" a second time.
 *
 * Getting the technical account needs NO real company: the qualification space issues a fictitious
 * structure and SIRET ("matelas de données") — see `credentials-guide.md` §3, which quotes AIFE's
 * own procedure.
 *
 * `CHORUSPRO_SELLER_SIRET` / `CHORUSPRO_BUYER_SIRET` / `CHORUSPRO_SELLER_VAT` — per-portal test
 * parameters, NOT credentials (same category as `credentials-guide.md`'s "Per-portal test parameters"
 * note: `*_COUNTRY`, `*_SELLER_VAT`, `*_BUYER_VAT`, `*_TAXPAYER_ID`). Optional overrides; their
 * defaults below are two real SIRETs drawn from the owner's own qualification "matelas de données"
 * (generated 2026-09-14, type "Plateforme agréée") plus a SIREN-derived seller VAT number (see the
 * `sellerVat` constant below for the derivation and why only the seller needs one) so the deposit
 * works out of the box for anyone using a standard mattress, while staying overridable for a
 * different one. See the SELLER/BUYER constants below for exactly which entities these are and, for
 * the buyer, why THIS one and not one of the other six.
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
 *   CHORUSPRO_LIVE=1 npx jest choruspro.live --no-coverage --runInBand
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
import {
  ChorusProClient,
  FetchChorusProHttpPort,
  mapChorusProStatus,
  resolveChorusProSyntax,
} from './choruspro-client';

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
    //
    // Both SIRETs come from the owner's Chorus Pro qualification "matelas de données" (generated
    // 2026-09-14, type "Plateforme agréée") — see `credentials-guide.md` §3 for how that mattress is
    // obtained. `scheme: 'LEGAL_ID'` is correct for a French SIRET: `country-identifiers/data/fr.json`
    // declares FR's ONLY `LEGAL_ID` scheme as "SIREN / SIRET", pattern `^\d{9}(\d{5})?$` (accepts
    // either length), and `build-semantic-invoice.ts#toSiren()` always reduces a 14-digit SIRET to its
    // first 9 digits (the SIREN) before emitting BT-29/BT-30 for a French seller — so feeding it the
    // full 14-digit SIRET, as both constants below do, is the documented, tested path, not a shortcut.
    //
    // Address/city/postal code are NOT sourced from the mattress (it supplies only the raison sociale
    // and the SIRET) — kept as plausible placeholders; Chorus Pro identifies a structure by SIRET, not
    // by postal address.
    //
    // Private-sector qualification structure, SIREN 332540215. Default raison sociale matches the
    // mattress's own "Fournisseur 33254021516357".
    //
    // DO NOT "FIX" THIS VALUE: 332540215 fails the standard SIREN Luhn checksum, and that is
    // DELIBERATE, not a typo — verified against AIFE's own qualification "matelas de données" CSV
    // (2026-09-14): this is the literal SIRET AIFE generated, byte-for-byte. Of the mattress's eight
    // SIRETs, 3 of 8 fail standard Luhn — AIFE does not guarantee Luhn validity for its fictitious
    // qualification identifiers, exactly like the PDP sandbox's own already-accepted `000000002`/
    // `000000001`. A future checksum audit must not "correct" this literal.
    const sellerSiret = process.env.CHORUSPRO_SELLER_SIRET ?? '33254021516357';
    // "Destinataire sans paramètre" is deliberate: the mattress offers seven public-sector
    // destinataires, and this is the ONLY one that imposes no extra deposit parameter. The other six
    // each require something this spec does not supply: an engagement juridique reference
    // (12345678200036, "avec EJ obligatoire"), a service code (12345678200028, "avec service
    // obligatoire", service SERVICE_DEST_SERV_OBL), both (12345678200044), or routing through the
    // SFACETAT service (11000201100044, "Destinataire Etat"). Do not swap this SIRET for one of those
    // without also adding the parameter it requires — the deposit will otherwise be rejected.
    const buyerSiret = process.env.CHORUSPRO_BUYER_SIRET ?? '12345678200051';

    // BT-31 (Seller VAT identifier) — REQUIRED here, not optional: the vendored EN 16931 Schematron's
    // own BR-S-02 (`formats/vendored/en16931/EN16931-CII-validation-preprocessed.sch`) reads —
    // "An Invoice that contains an Invoice line (BG-25) where the Invoiced item VAT category code
    // (BT-151) is "Standard rated" shall contain the Seller VAT Identifier (BT-31), the Seller tax
    // registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63)."
    // This spec's own line carries `vatRate: '20'` (> 0 → category 'S' via
    // `build-semantic-invoice.ts#vatCategoryFor`), so BR-S-02 applies — measured live 2026-09-14, the
    // exact gate rejection this constant fixes ("EN 16931 Schematron gate rejected the CII: BR-S-02:
    // ...").
    //
    // Mechanically DERIVED from the seller SIREN above (332540215), never invented: a French
    // intra-Community VAT number is `FR` + a 2-digit key + the 9-digit SIREN, key = (12 + 3 × (SIREN
    // mod 97)) mod 97 (`tax/vat-syntax.ts`'s own header, sourced
    // https://fr.wikipedia.org/wiki/Num%C3%A9ro_de_TVA_intracommunautaire#France). For 332540215:
    // SIREN mod 97 = 62, key = (12 + 3×62) mod 97 = 198 mod 97 = 4 → "04" → FR04332540215. Verified
    // against this codebase's OWN `validateFrVat` (`tax/vat-syntax.ts`) rather than hand-trusted:
    // `validateFrVat('FR04332540215')` → `{ valid: true, checksumValidated: true }`.
    //
    // Only the SELLER needs one: BR-S-02 and its "Standard rated" siblings (BR-S-03/BR-S-04, the
    // Document-level-allowance/charge variants) name only `SellerTradeParty` /
    // `SellerTaxRepresentativeTradeParty` in the vendored Schematron — never `BuyerTradeParty`,
    // confirmed by reading every `BR-S-*` rule directly. The one rule that DOES mention a buyer VAT
    // id, BR-CO-09, only constrains its PREFIX if one is present ("...shall have a prefix in
    // accordance with ISO code ISO 3166-1 alpha-2..."), never requires its presence; BR-CO-26 (seller
    // identifiability) is already satisfied by the seller's own `LEGAL_ID`/SIREN above. So the buyer
    // intentionally carries no VAT identifier here — not an oversight.
    const sellerVat = process.env.CHORUSPRO_SELLER_VAT ?? 'FR04332540215';

    // BT-81 (Payment means type code) — REQUIRED here, not optional, for a Chorus Pro deposit
    // specifically: measured live 2026-09-14, `deposerFlux` DID accept a Factur-X built WITHOUT an
    // IBAN (the base EN 16931 Schematron's own BR-49 only fires once `SpecifiedTradeSettlementPaymentMeans`
    // exists at all — omitted entirely is not a Schematron violation), but `consulterCRDetaille`
    // REJECTED it downstream (`flux CPP0011117000000000425895`, DEPOSE→IN_REJETE, citing
    // `SpecifiedTradeSettlementPaymentMeans.TypeCode.value est obligatoire`) — AIFE's own "Dossier de
    // spécifications externes de Chorus Pro — Annexe relative au raccordement EDI" V4.20, p.22, marks
    // "Mode de paiement" "O" (Obligatoire) unconditionally. A syntactically valid (mod-97 checksum
    // verified), sandbox-appropriate test IBAN — `build-semantic-invoice.ts#sellerPaymentMeans` only
    // emits BT-81 (code '30' — "Credit Transfert"/"Virement", one of S2.05's own accepted values,
    // p.168) when `seller.iban` is actually set, honest, never fabricated when absent, the same
    // discipline `chorus-pro-transport.ts`'s own new "PAYMENT MEANS GATE" now enforces for a real send.
    const sellerIban = process.env.CHORUSPRO_SELLER_IBAN ?? 'FR7630006000011234567890189';

    const SELLER: SemanticPartyInput = {
      name: `Fournisseur ${sellerSiret}`,
      address: '1 rue du Test',
      city: 'Paris',
      postalCode: '75001',
      country: 'France',
      email: 'seller@example.fr',
      iban: sellerIban,
      partyIdentifiers: [
        { scheme: 'LEGAL_ID', value: sellerSiret },
        { scheme: 'VAT', value: sellerVat },
      ],
    };
    const BUYER: SemanticPartyInput = {
      name: process.env.CHORUSPRO_BUYER_SIRET ? `Destinataire ${buyerSiret}` : 'Destinataire sans paramètre',
      address: '20 avenue de Ségur',
      city: 'Paris',
      postalCode: '75007',
      country: 'France',
      email: 'buyer@example.fr',
      partyIdentifiers: [{ scheme: 'LEGAL_ID', value: buyerSiret }],
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
      // BT-23 — mirrors the SAME override `chorus-pro-transport.ts`'s own dedicated
      // `facturxFormatProvider` instance now passes for every real Chorus Pro send
      // (`documents-core.module.ts`) — see `SemanticInvoiceInput.businessProcessCodeOverride`'s own
      // header for the full sourcing. Without it, this bridge would derive the CGI-reform value
      // ('M1' — no line here declares a `supplyType`) into
      // `BusinessProcessSpecifiedDocumentContextParameter/ID`, the EXACT element Chorus Pro's own
      // "Cadre (Mode de Facturation)" concept also occupies (AIFE's Chorus Pro EDI annex, G1.02: only
      // A1-A25 are accepted there) — measured live 2026-09-14 as the second half of the
      // `CPP0011117000000000425895` rejection (`consulterCRDetaille`,
      // `BusinessProcessSpecifiedDocumentContextParameter.I[D]`, truncated by the platform's own
      // ~200-char `libelleErreurDP` cutoff). This hand-built recipe does not go through
      // `facturxFormatProvider.build()` (see this file's own header, "DB-free approach"), so it needs
      // its OWN copy of this override to stay a faithful mirror of what `chorus-pro-transport.ts#send()`
      // actually deposits.
      businessProcessCodeOverride: 'A1',
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
    // `resolveChorusProSyntax('FACTURX')` — the EXACT call `chorus-pro-transport.ts#send()` makes
    // (`facturxFormatProvider.syntax` is the fixed string `'FACTURX'`, `facturx-provider.ts`) — rather
    // than a second hardcoded literal that could silently drift from the one production path actually
    // uses. Resolves to `IN_DP_E2_CII_FACTURX`; see `choruspro-client.ts`'s own header, "CORRECTED
    // 2026-09-14 (second correction, same day)", for the Swagger + AIFE community-doc sourcing.
    const depositResult = await client.deposerFlux(
      Buffer.from(facturxPdf),
      `INV-CPR-${timestamp}.pdf`,
      resolveChorusProSyntax('FACTURX'),
    );
    console.log('[choruspro-live] deposit result:', JSON.stringify(depositResult, null, 2));

    // HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md) — an empty numeroFluxDepot is a hard failure, never a
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
