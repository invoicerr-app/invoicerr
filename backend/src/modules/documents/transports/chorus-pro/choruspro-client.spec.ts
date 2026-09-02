/**
 * Chorus Pro client — mocked / structural tests. REPRISED from git tag `avant-refonte-documents`'s
 * own `choruspro-client.spec.ts` — same assertions, adapted for the ONE structural change this wave
 * makes (`deposerFlux` takes a `Buffer`, not a UTF-8 `string` — see `choruspro-client.ts`'s own header,
 * adaptation §1).
 *
 * No network calls — all HTTP responses are stubs. The REAL round-trip (`FetchChorusProHttpPort`
 * against the real PISTE sandbox) is proven separately, gated, in `choruspro-live.spec.ts`.
 *
 * Tests:
 *  - ChorusProClient constructs without errors.
 *  - _getToken() sends correct OAuth2 client_credentials request.
 *  - _getToken() caches token; does NOT call /token twice within TTL.
 *  - _getToken() throws when auth returns 4xx.
 *  - deposerFlux() posts to the correct path with correct body.
 *  - deposerFlux() includes Authorization + cpro-account headers.
 *  - cpro-account header is base64(login:password).
 *  - deposerFlux() extracts numeroFluxDepot from response.
 *  - deposerFlux() throws when HTTP returns 4xx.
 *  - deposerFlux() with an EMPTY numeroFluxDepot in an otherwise-200 response — MUTATION GUARD #1's
 *    own client-level companion: the client itself does not silently invent one; the hard-success
 *    contract lives in `chorus-pro-transport.ts#send()`, checked in that file's own spec — this test
 *    only proves the client reports back exactly what PISTE said, empty string included.
 *  - consulterCr() posts to the correct path.
 *  - consulterCr() returns statutFlux from response.
 *  - consulterCr() throws on 4xx.
 *  - mapChorusProStatus() maps each Chorus Pro status to the canonical value.
 *  - resolveChorusProSyntax() maps artifact syntax codes correctly.
 *  - CHORUSPRO_PATHS table uses the documented paths.
 *
 * Live integration deferred — see `choruspro-live.spec.ts`'s own header for exactly what is (and is
 * not) proven without a real PISTE account.
 */
import {
  CHORUSPRO_PATHS,
  ChorusProClient,
  ChorusProClientConfig,
  ChorusProHttpPort,
  mapChorusProStatus,
  resolveChorusProSyntax,
} from './choruspro-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: ChorusProClientConfig = {
  oauthBaseUrl: 'https://sandbox-oauth.piste.gouv.fr',
  apiBaseUrl: 'https://sandbox-api.piste.gouv.fr',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  technicalAccountLogin: 'login_technique',
  technicalAccountPassword: 'password_technique',
};

const TOKEN_RESPONSE = { status: 200, data: { access_token: 'tok123', expires_in: 3600 } };

// A binary-looking payload (not valid UTF-8 text) — proves the Buffer path never round-trips through
// a UTF-8 string first (adaptation §1's own reason for existing).
const FACTURX_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0xfe, 0x00, 0x01]);

function makeHttp(overrides: Partial<ChorusProHttpPort> = {}): ChorusProHttpPort {
  return {
    post: async () => ({ status: 200, data: {} }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CHORUSPRO_PATHS
// ---------------------------------------------------------------------------
describe('CHORUSPRO_PATHS', () => {
  it('OAuth token endpoint uses /api/oauth/token', () => {
    expect(CHORUSPRO_PATHS.token).toBe('/api/oauth/token');
  });
  it('deposerFlux uses /cpro/factures/v1/deposer/flux', () => {
    expect(CHORUSPRO_PATHS.deposerFlux).toBe('/cpro/factures/v1/deposer/flux');
  });
  it('consulterCr uses /cpro/factures/v1/consulter/cr', () => {
    expect(CHORUSPRO_PATHS.consulterCr).toBe('/cpro/factures/v1/consulter/cr');
  });
});

// ---------------------------------------------------------------------------
// mapChorusProStatus
// ---------------------------------------------------------------------------
describe('mapChorusProStatus', () => {
  it('maps VALIDE → CLEARED', () => {
    expect(mapChorusProStatus('VALIDE')).toBe('CLEARED');
    expect(mapChorusProStatus('valide')).toBe('CLEARED');
  });
  it('maps MISE_EN_PAIEMENT → CLEARED', () => {
    expect(mapChorusProStatus('MISE_EN_PAIEMENT')).toBe('CLEARED');
  });
  it('maps MANDATEE → CLEARED', () => {
    expect(mapChorusProStatus('MANDATEE')).toBe('CLEARED');
  });
  it('maps COMPTABILISEE → CLEARED', () => {
    expect(mapChorusProStatus('COMPTABILISEE')).toBe('CLEARED');
  });
  it('maps REJETE → REJECTED', () => {
    expect(mapChorusProStatus('REJETE')).toBe('REJECTED');
    expect(mapChorusProStatus('rejete')).toBe('REJECTED');
  });
  it('maps DEPOSE → PENDING', () => {
    expect(mapChorusProStatus('DEPOSE')).toBe('PENDING');
  });
  it('maps EN_COURS_DE_TRAITEMENT → PENDING', () => {
    expect(mapChorusProStatus('EN_COURS_DE_TRAITEMENT')).toBe('PENDING');
  });
  it('maps SUSPENDU → PENDING', () => {
    expect(mapChorusProStatus('SUSPENDU')).toBe('PENDING');
  });
  it('maps unknown → PENDING', () => {
    expect(mapChorusProStatus('WHATEVER')).toBe('PENDING');
  });
});

// ---------------------------------------------------------------------------
// resolveChorusProSyntax
// ---------------------------------------------------------------------------
describe('resolveChorusProSyntax', () => {
  it('maps EN16931_UBL → IN_DP_E1_UBL_201', () => {
    expect(resolveChorusProSyntax('EN16931_UBL')).toBe('IN_DP_E1_UBL_201');
  });
  it('maps EN16931_CII → IN_DP_E2_CII_16B', () => {
    expect(resolveChorusProSyntax('EN16931_CII')).toBe('IN_DP_E2_CII_16B');
  });
  it('maps FACTURX → IN_DP_E3_FACTUR_X_10', () => {
    expect(resolveChorusProSyntax('FACTURX')).toBe('IN_DP_E3_FACTUR_X_10');
  });
  it('maps unknown syntax → IN_DP_E1_UBL_201 (safe default)', () => {
    expect(resolveChorusProSyntax('UNKNOWN')).toBe('IN_DP_E1_UBL_201');
  });
});

// ---------------------------------------------------------------------------
// ChorusProClient — authentication
// ---------------------------------------------------------------------------
describe('ChorusProClient — authentication', () => {
  it('POSTs to the OAuth token endpoint with client_credentials body', async () => {
    let capturedUrl = '';
    let capturedBody = '';

    const http = makeHttp({
      post: async (url, body) => {
        capturedUrl = url;
        capturedBody = String(body);
        return TOKEN_RESPONSE;
      },
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    // Force token fetch
    await client._getToken();

    expect(capturedUrl).toBe('https://sandbox-oauth.piste.gouv.fr/api/oauth/token');
    expect(capturedBody).toContain('grant_type=client_credentials');
    expect(capturedBody).toContain('client_id=test-client-id');
    // client_secret must be in body but NOT logged — check it's passed
    expect(capturedBody).toContain('client_secret=test-client-secret');
    expect(capturedBody).toContain('scope=openid');
  });

  it('throws when auth returns 4xx', async () => {
    const http = makeHttp({
      post: async () => ({ status: 401, data: { error: 'unauthorized' } }),
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    await expect(client._getToken()).rejects.toThrow('Chorus Pro PISTE authentication failed (HTTP 401)');
  });

  it('caches token — does not call /token twice within TTL', async () => {
    let tokenCallCount = 0;
    const http = makeHttp({
      post: async (url, _body) => {
        if (String(url).includes('/token')) {
          tokenCallCount++;
          return TOKEN_RESPONSE;
        }
        return { status: 200, data: { numeroFluxDepot: '1', statut: 'DEPOSE' } };
      },
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    // Call deposerFlux twice — token should be fetched once
    await client.deposerFlux(FACTURX_BYTES, 'test.pdf');
    await client.deposerFlux(FACTURX_BYTES, 'test.pdf');
    expect(tokenCallCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ChorusProClient — deposerFlux
// ---------------------------------------------------------------------------
describe('ChorusProClient — deposerFlux', () => {
  it('POSTs to the correct deposerFlux path', async () => {
    let capturedUrl = '';
    const http = makeHttp({
      post: async (url, _body) => {
        capturedUrl = url;
        if (String(url).includes('/token')) return TOKEN_RESPONSE;
        return { status: 200, data: { numeroFluxDepot: '99', statut: 'DEPOSE' } };
      },
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    await client.deposerFlux(FACTURX_BYTES, 'test.pdf');
    expect(capturedUrl).toBe('https://sandbox-api.piste.gouv.fr/cpro/factures/v1/deposer/flux');
  });

  it('includes Authorization Bearer + cpro-account in headers', async () => {
    let capturedHeaders: Record<string, string> = {};
    const http = makeHttp({
      post: async (url, _body, headers) => {
        if (String(url).includes('/token')) return TOKEN_RESPONSE;
        capturedHeaders = headers as Record<string, string>;
        return { status: 200, data: { numeroFluxDepot: '10', statut: 'DEPOSE' } };
      },
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    await client.deposerFlux(FACTURX_BYTES, 'test.pdf');

    expect(capturedHeaders.Authorization).toBe('Bearer tok123');
    expect(capturedHeaders['cpro-account']).toBeDefined();
    // cpro-account must be base64(login:password)
    const expected = Buffer.from('login_technique:password_technique', 'utf-8').toString('base64');
    expect(capturedHeaders['cpro-account']).toBe(expected);
  });

  it('cpro-account header is base64(login:password)', () => {
    const login = 'my_login';
    const password = 'my_password';
    const expected = Buffer.from(`${login}:${password}`, 'utf-8').toString('base64');
    // Verify the encoding formula independently
    expect(Buffer.from(expected, 'base64').toString('utf-8')).toBe(`${login}:${password}`);
  });

  it('sends syntaxeFlux, nomFichier, fichierFlux in the body — fichierFlux is base64 of the RAW bytes, never a UTF-8-decoded round-trip', async () => {
    let capturedBody: Record<string, unknown> = {};
    const http = makeHttp({
      post: async (url, body) => {
        if (String(url).includes('/token')) return TOKEN_RESPONSE;
        capturedBody = body as Record<string, unknown>;
        return { status: 200, data: { numeroFluxDepot: '5', statut: 'DEPOSE' } };
      },
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    await client.deposerFlux(FACTURX_BYTES, 'invoice.pdf', 'IN_DP_E3_FACTUR_X_10');

    expect(capturedBody.syntaxeFlux).toBe('IN_DP_E3_FACTUR_X_10');
    expect(capturedBody.nomFichier).toBe('invoice.pdf');
    // fichierFlux must be base64 of the RAW Buffer — see adaptation §1 (choruspro-client.ts's own
    // header): a UTF-8 string round-trip would corrupt these non-UTF-8 bytes (0xff/0xfe above).
    expect(capturedBody.fichierFlux).toBe(FACTURX_BYTES.toString('base64'));
    // Proves the round-trip is lossless: decoding the captured base64 gives back the EXACT same bytes.
    expect(Buffer.from(capturedBody.fichierFlux as string, 'base64').equals(FACTURX_BYTES)).toBe(true);
  });

  it('extracts numeroFluxDepot from response', async () => {
    const http = makeHttp({
      post: async (url) => {
        if (String(url).includes('/token')) return TOKEN_RESPONSE;
        return { status: 200, data: { numeroFluxDepot: '42', statut: 'DEPOSE' } };
      },
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    const result = await client.deposerFlux(FACTURX_BYTES, 'test.pdf');
    expect(result.numeroFluxDepot).toBe('42');
    expect(result.statut).toBe('DEPOSE');
    expect(result.httpStatus).toBe(200);
  });

  it('throws when HTTP returns 4xx', async () => {
    const http = makeHttp({
      post: async (url) => {
        if (String(url).includes('/token')) return TOKEN_RESPONSE;
        return { status: 422, data: { message: 'Unprocessable Entity' } };
      },
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    await expect(client.deposerFlux(FACTURX_BYTES, 'test.pdf')).rejects.toThrow(
      'Chorus Pro deposerFlux failed (HTTP 422)',
    );
  });

  it('reports back an EMPTY numeroFluxDepot as-is (never invents one) when PISTE answers 200 with none', async () => {
    const http = makeHttp({
      post: async (url) => {
        if (String(url).includes('/token')) return TOKEN_RESPONSE;
        return { status: 200, data: { statut: 'DEPOSE' } }; // no numeroFluxDepot at all
      },
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    const result = await client.deposerFlux(FACTURX_BYTES, 'test.pdf');
    expect(result.numeroFluxDepot).toBe('');
  });

  it('uses IN_DP_E1_UBL_201 as default syntaxeFlux', async () => {
    let capturedBody: Record<string, unknown> = {};
    const http = makeHttp({
      post: async (url, body) => {
        if (String(url).includes('/token')) return TOKEN_RESPONSE;
        capturedBody = body as Record<string, unknown>;
        return { status: 200, data: { numeroFluxDepot: '1', statut: 'DEPOSE' } };
      },
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    await client.deposerFlux(FACTURX_BYTES, 'test.pdf');
    expect(capturedBody.syntaxeFlux).toBe('IN_DP_E1_UBL_201');
  });
});

// ---------------------------------------------------------------------------
// ChorusProClient — consulterCr
// ---------------------------------------------------------------------------
describe('ChorusProClient — consulterCr', () => {
  it('POSTs to the correct consulterCr path', async () => {
    let capturedUrl = '';
    const http = makeHttp({
      post: async (url) => {
        capturedUrl = url;
        if (String(url).includes('/token')) return TOKEN_RESPONSE;
        return { status: 200, data: { numeroFluxDepot: '42', statutFlux: 'EN_COURS_DE_TRAITEMENT' } };
      },
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    await client.consulterCr('42');
    expect(capturedUrl).toBe('https://sandbox-api.piste.gouv.fr/cpro/factures/v1/consulter/cr');
  });

  it('sends numeroFluxDepot in the body', async () => {
    let capturedBody: Record<string, unknown> = {};
    const http = makeHttp({
      post: async (url, body) => {
        if (String(url).includes('/token')) return TOKEN_RESPONSE;
        capturedBody = body as Record<string, unknown>;
        return { status: 200, data: { numeroFluxDepot: '42', statutFlux: 'VALIDE' } };
      },
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    await client.consulterCr('42');
    expect(capturedBody.numeroFluxDepot).toBe('42');
  });

  it('returns statutFlux from response', async () => {
    const http = makeHttp({
      post: async (url) => {
        if (String(url).includes('/token')) return TOKEN_RESPONSE;
        return { status: 200, data: { numeroFluxDepot: '42', statutFlux: 'VALIDE' } };
      },
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    const result = await client.consulterCr('42');
    expect(result.statutFlux).toBe('VALIDE');
    expect(result.numeroFluxDepot).toBe('42');
  });

  it('throws on 4xx', async () => {
    const http = makeHttp({
      post: async (url) => {
        if (String(url).includes('/token')) return TOKEN_RESPONSE;
        return { status: 404, data: { message: 'Flux not found' } };
      },
    });
    const client = new ChorusProClient(BASE_CONFIG, http);
    await expect(client.consulterCr('unknown')).rejects.toThrow('Chorus Pro consulterCr failed (HTTP 404)');
  });
});
