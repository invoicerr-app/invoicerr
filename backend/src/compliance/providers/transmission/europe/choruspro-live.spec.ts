/**
 * Chorus Pro PISTE live round-trip test.
 *
 * Gated: CHORUSPRO_LIVE=1 — never runs in CI.
 *
 * Required env vars:
 *   CHORUSPRO_LIVE=1
 *   CHORUSPRO_CLIENT_ID        PISTE OAuth2 client_id
 *   CHORUSPRO_CLIENT_SECRET    PISTE OAuth2 client_secret
 *
 * Optional env vars (required for a full deposit round-trip):
 *   CHORUSPRO_TECH_LOGIN       Chorus Pro technical account login
 *   CHORUSPRO_TECH_PASSWORD    Chorus Pro technical account password
 *   CHORUSPRO_ENV              SANDBOX | PROD  (default: SANDBOX)
 *   CHORUSPRO_XML_PATH         Path to a pre-built Factur-X / UBL XML file (UTF-8)
 *                              If absent, a minimal UBL invoice is generated.
 *
 * Hard-success contract:
 *   - transmit status MUST be PENDING (not REJECTED / SKIPPED).
 *   - ref MUST be truthy (real numeroFluxDepot returned).
 *   - A subsequent consulterCr poll MUST return a non-error status.
 *
 * Run:
 *   cd backend
 *   CHORUSPRO_LIVE=1 \
 *     CHORUSPRO_CLIENT_ID=<id> \
 *     CHORUSPRO_CLIENT_SECRET=<secret> \
 *     CHORUSPRO_TECH_LOGIN=<login> \
 *     CHORUSPRO_TECH_PASSWORD=<password> \
 *     npx jest choruspro-live --no-coverage --runInBand
 */
export {};

import { liveDescribe } from '../live-gate.js';

const describeLive = liveDescribe('CHORUSPRO_LIVE', [
  'CHORUSPRO_CLIENT_ID',
  'CHORUSPRO_CLIENT_SECRET',
]);

describeLive('Chorus Pro PISTE live round-trip', () => {
  it('deposits an invoice flux and receives a real numeroFluxDepot', async () => {
    const clientId         = process.env.CHORUSPRO_CLIENT_ID!;
    const clientSecret     = process.env.CHORUSPRO_CLIENT_SECRET!;
    const techLogin        = process.env.CHORUSPRO_TECH_LOGIN    ?? '';
    const techPassword     = process.env.CHORUSPRO_TECH_PASSWORD ?? '';
    const envStr           = (process.env.CHORUSPRO_ENV ?? 'SANDBOX').toUpperCase();
    const isSandbox        = envStr !== 'PROD';

    const oauthBaseUrl = isSandbox
      ? 'https://sandbox-oauth.piste.gouv.fr'
      : 'https://oauth.piste.gouv.fr';
    const apiBaseUrl = isSandbox
      ? 'https://sandbox-api.piste.gouv.fr'
      : 'https://api.piste.gouv.fr';

    console.log('[choruspro-live] Environment:', isSandbox ? 'SANDBOX' : 'PROD');
    console.log('[choruspro-live] OAuth base:', oauthBaseUrl);
    console.log('[choruspro-live] API base:  ', apiBaseUrl);

    // Build a minimal Factur-X / UBL invoice XML.
    let xmlBytes: Buffer;
    const xmlPath = process.env.CHORUSPRO_XML_PATH;
    if (xmlPath) {
      const { readFileSync } = await import('fs');
      xmlBytes = readFileSync(xmlPath);
      console.log('[choruspro-live] Loaded XML from', xmlPath, '—', xmlBytes.length, 'bytes');
    } else {
      const { InvoiceRenderingService } = await import(
        '../../../../modules/invoice-rendering/invoice-rendering.service.js'
      );
      const svc = new InvoiceRenderingService();
      const now = new Date();
      const timestamp = Date.now();
      const inv = svc.buildEInvoice({
        rawNumber: `INV-CPR-${timestamp}`,
        number: null,
        issuedAt: now,
        createdAt: now,
        company: {
          name: 'Test Fournisseur SAS',
          description: null,
          foundedAt: null,
          currency: 'EUR',
          address: '1 rue du Test',
          city: 'Paris',
          postalCode: '75001',
          country: 'France',
          partyIdentifiers: [{ scheme: 'SIRET', value: '12345678900011' }],
        },
        client: {
          type: 'COMPANY',
          name: 'Ministère du Test',
          description: null,
          foundedAt: null,
          contactFirstname: null,
          contactLastname: null,
          contactEmail: null,
          contactPhone: null,
          salutation: null,
          sex: null,
          title: null,
          isActive: true,
          address: '20 avenue de Ségur',
          city: 'Paris',
          postalCode: '75007',
          country: 'France',
          partyIdentifiers: [{ scheme: 'SIRET', value: '98765432100022' }],
        },
        items: [{ name: 'Prestations de service', quantity: 1, unitPrice: 1000, vatRate: 20, type: 'SERVICE' }],
      } as any);
      const xml = await inv.exportXml('ubl');
      xmlBytes = Buffer.from(xml, 'utf8');
      console.log('[choruspro-live] Generated UBL XML —', xmlBytes.length, 'bytes');
    }

    // Provide a real fetch-based HTTP port.
    const { ChorusProClient } = await import('./choruspro-client.js');

    const realHttp = {
      post: async (url: string, body: unknown, headers: Record<string, string>) => {
        const isForm = headers['Content-Type']?.includes('x-www-form-urlencoded');
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: isForm ? String(body) : JSON.stringify(body),
        });
        let data: unknown;
        try { data = await res.json(); } catch { data = await res.text(); }
        return { status: res.status, data };
      },
    };

    const client = new ChorusProClient(
      {
        oauthBaseUrl,
        apiBaseUrl,
        clientId,
        clientSecret,
        technicalAccountLogin:    techLogin,
        technicalAccountPassword: techPassword,
      },
      realHttp,
    );

    // Step 1: authenticate (verify token endpoint reachable)
    let token: string;
    try {
      token = await (client as any)._getToken();
    } catch (err) {
      fail(`[choruspro-live] Authentication failed: ${String(err)}`);
      return;
    }
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    console.log('[choruspro-live] Auth OK — token length:', token.length);

    // Step 2: deposit flux (only if compte technique credentials are provided)
    if (!techLogin || !techPassword) {
      console.warn('[choruspro-live] CHORUSPRO_TECH_LOGIN / CHORUSPRO_TECH_PASSWORD not set — skipping deposerFlux');
      return;
    }

    const xmlStr = xmlBytes.toString('utf-8');
    const depositResult = await client.deposerFlux(xmlStr, `test-${Date.now()}.xml`);
    console.log('[choruspro-live] Deposit result:', JSON.stringify(depositResult, null, 2));

    expect(depositResult.numeroFluxDepot).toBeTruthy();
    if (!depositResult.numeroFluxDepot) {
      fail('[choruspro-live] No numeroFluxDepot returned — hard failure');
      return;
    }

    // Step 3: poll consulterCr at least once
    const { mapChorusProStatus } = await import('./choruspro-client.js');
    const crResult = await client.consulterCr(depositResult.numeroFluxDepot);
    console.log('[choruspro-live] consulterCr result:', JSON.stringify(crResult, null, 2));

    const status = mapChorusProStatus(crResult.statutFlux);
    console.log('[choruspro-live] Canonical status:', status);

    if (status === 'REJECTED') {
      fail(`[choruspro-live] consulterCr returned REJETE — hard failure. CR: ${JSON.stringify(crResult)}`);
    }
    // PENDING or CLEARED are both acceptable for a single-poll live check
    expect(['PENDING', 'CLEARED']).toContain(status);
  }, 60_000);
});
