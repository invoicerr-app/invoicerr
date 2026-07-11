/**
 * Generic national-portal scaffold — consolidated tests.
 *
 * Replaces the five near-identical regional smaller-portals spec files with:
 *  1. Shared factory behaviour (injected HTTP + credentials fakes):
 *     unconfigured → SKIPPED, submit posts the right shape, async poll mapping,
 *     real-time SENT, error → REJECTED, ref/notes format, stub port message.
 *  2. Per-region data guards: counts, unique ids (per region AND globally),
 *     GOV_PORTAL_API channel, configSchema fields, async vs real-time sets.
 *
 * Live integration deferred — no sandbox credentials available.
 */
import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { RecordingComplianceLogger } from '../../execution/logger';
import { SignedArtifact } from '../../execution/types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import {
  GenericPortalSpec,
  PortalResponseHeuristics,
  SimpleHttpPort,
  buildGenericPortalProvider,
  mapPortalStatus,
} from './generic-portal';

import { SMALL_AFRICA_PROVIDERS } from './africa/smaller-portals';
import { SMALL_ASIA_PROVIDERS } from './asia/smaller-portals';
import { EUROPE_PORTAL_PROVIDERS } from './europe/europe-smaller-portals';
import { LATAM_PORTAL_HEURISTICS, SMALL_LATAM_PROVIDERS } from './latam/smaller-portals';
import { SMALL_MENA_PROVIDERS } from './mena/mena-smaller-portals';

// ---------------------------------------------------------------------------
// 1. Shared factory behaviour
// ---------------------------------------------------------------------------

const HEURISTICS: PortalResponseHeuristics = {
  idFields: ['id', 'uuid'],
  statusFields: ['status', 'result'],
  statusFallback: 'PENDING',
  clearTokens: ['APPROVED', 'CLEARED'],
  rejectTokens: ['REJECTED', 'INVALID'],
};

const SPEC: GenericPortalSpec = {
  id: 'xx-portal',
  label: 'Test Portal',
  artifact: 'EN16931_UBL',
  baseUrls: { test: 'https://test.example.gov/api', prod: 'https://example.gov/api' },
  authHint: 'API key from the portal',
  submitEndpoint: '/invoices',
  pollEndpoint: '/invoices/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'Environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'API token', required: true, secret: true },
  ],
};

const artifacts: SignedArtifact[] = [
  { role: 'AUTHORITATIVE', syntax: 'EN16931_UBL', mime: 'application/xml', bytes: Buffer.from('<Invoice/>') },
];
const ctx = { supplierCompanyId: 'company1' } as unknown as TransactionContext;
const plan = {} as CompliancePlan;

const resolvedConfig: ResolvedChannelConfig = {
  providerId: 'xx-portal',
  channel: 'GOV_PORTAL_API',
  environment: 'TEST',
  config: { environment: 'test', apiToken: 'tok-123' },
  isActive: true,
};

const makeHttp = (overrides: Partial<SimpleHttpPort> = {}): SimpleHttpPort & { calls: unknown[][] } => {
  const calls: unknown[][] = [];
  return {
    calls,
    post: async (url, body, headers) => {
      calls.push(['post', url, body, headers]);
      return { status: 200, data: { id: 'sub-42' } };
    },
    get: async (url, headers) => {
      calls.push(['get', url, headers]);
      return { status: 200, data: { status: 'APPROVED' } };
    },
    ...overrides,
  };
};

const makeCredentials = (config: ResolvedChannelConfig | null): ChannelCredentialsPort => ({
  resolve: async () => config,
  resolveActive: async () => config,
});

describe('buildGenericPortalProvider (shared behaviour)', () => {
  const log = new RecordingComplianceLogger();

  it('returns SKIPPED when no resolved config', async () => {
    const p = buildGenericPortalProvider(SPEC, HEURISTICS);
    const result = await p.transmit(artifacts, ctx, plan, 'key', log, undefined);
    expect(result.status).toBe('SKIPPED');
    expect(result.notes).toContain('xx-portal: no resolved config');
  });

  it('returns SKIPPED when the required artifact syntax is missing', async () => {
    const p = buildGenericPortalProvider(SPEC, HEURISTICS);
    const result = await p.transmit([], ctx, plan, 'key', log, resolvedConfig);
    expect(result.status).toBe('SKIPPED');
    expect(result.notes).toContain('xx-portal: no EN16931_UBL artifact');
  });

  it('returns SKIPPED when ctx has no supplierCompanyId', async () => {
    const p = buildGenericPortalProvider(SPEC, HEURISTICS);
    const result = await p.transmit(artifacts, {} as TransactionContext, plan, 'key', log, resolvedConfig);
    expect(result.status).toBe('SKIPPED');
    expect(result.notes).toContain('xx-portal: no supplierCompanyId');
  });

  it('submit POSTs {document, idempotencyKey} with Bearer token to test baseUrl and returns PENDING + ref', async () => {
    const http = makeHttp();
    const p = buildGenericPortalProvider(SPEC, HEURISTICS, undefined, http);
    const result = await p.transmit(artifacts, ctx, plan, 'idem-key', log, resolvedConfig);
    expect(result.status).toBe('PENDING'); // default: clearance-style async
    expect(result.ref).toBe('company1|sub-42');
    expect(result.notes).toContain('id: sub-42');
    const [method, url, body, headers] = http.calls[0] as [
      string,
      string,
      Record<string, unknown>,
      Record<string, string>,
    ];
    expect(method).toBe('post');
    expect(url).toBe('https://test.example.gov/api/invoices');
    expect(body).toEqual({ document: '<Invoice/>', idempotencyKey: 'idem-key' });
    expect(headers.Authorization).toBe('Bearer tok-123');
  });

  it('uses the prod baseUrl when config.environment is prod', async () => {
    const http = makeHttp();
    const p = buildGenericPortalProvider(SPEC, HEURISTICS, undefined, http);
    await p.transmit(artifacts, ctx, plan, 'k', log, {
      ...resolvedConfig,
      config: { environment: 'prod', apiToken: 'tok-123' },
    });
    expect((http.calls[0] as string[])[1]).toBe('https://example.gov/api/invoices');
  });

  it('real-time portals (isAsync: false) return SENT and expose no poll()', async () => {
    const http = makeHttp();
    const p = buildGenericPortalProvider({ ...SPEC, isAsync: false }, HEURISTICS, undefined, http);
    expect(p.feedback).toBe('NONE');
    expect(p.pollPolicy).toBeUndefined();
    expect(p.poll).toBeUndefined();
    const result = await p.transmit(artifacts, ctx, plan, 'k', log, resolvedConfig);
    expect(result.status).toBe('SENT');
    expect(result.ref).toBe('company1|sub-42');
  });

  it('async portals are ASYNC_POLL with a poll policy', () => {
    const p = buildGenericPortalProvider(SPEC, HEURISTICS);
    expect(p.channel).toBe('GOV_PORTAL_API');
    expect(p.feedback).toBe('ASYNC_POLL');
    expect(p.pollPolicy).toEqual({ everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' });
    expect(p.configSchema?.fields).toBe(SPEC.configFields);
  });

  it('falls back to tx-… id when the response has none of the idFields', async () => {
    const http = makeHttp({ post: async () => ({ status: 200, data: { other: 1 } }) });
    const p = buildGenericPortalProvider(SPEC, HEURISTICS, undefined, http);
    const result = await p.transmit(artifacts, ctx, plan, 'k', log, resolvedConfig);
    expect(result.ref).toMatch(/^company1\|tx-\d+$/);
  });

  it('returns REJECTED with the error note when submit gets HTTP >= 400', async () => {
    const http = makeHttp({ post: async () => ({ status: 500, data: {} }) });
    const p = buildGenericPortalProvider(SPEC, HEURISTICS, undefined, http);
    const result = await p.transmit(artifacts, ctx, plan, 'k', log, resolvedConfig);
    expect(result.status).toBe('REJECTED');
    expect(result.notes).toContain('xx-portal: Test Portal: submission failed (HTTP 500)');
  });

  it('default (stub) HTTP port rejects with the authHint message', async () => {
    const p = buildGenericPortalProvider(SPEC, HEURISTICS);
    const result = await p.transmit(artifacts, ctx, plan, 'k', log, resolvedConfig);
    expect(result.status).toBe('REJECTED');
    expect(result.notes).toContain(
      'xx-portal: Test Portal HTTP port not implemented — API key from the portal',
    );
  });

  describe('poll()', () => {
    it('returns PENDING on malformed ref', async () => {
      const p = buildGenericPortalProvider(SPEC, HEURISTICS);
      const result = await p.poll!('malformed-ref-without-pipe', log);
      expect(result.status).toBe('PENDING');
      expect(result.notes).toContain('xx-portal: invalid ref');
    });

    it('returns PENDING when no credentials port is wired', async () => {
      const p = buildGenericPortalProvider(SPEC, HEURISTICS);
      const result = await p.poll!('company1|sub-42', log);
      expect(result.status).toBe('PENDING');
      expect(result.notes).toContain('xx-portal: no credentials port');
    });

    it('returns PENDING when credentials resolve inactive', async () => {
      const p = buildGenericPortalProvider(SPEC, HEURISTICS, makeCredentials(null), makeHttp());
      const result = await p.poll!('company1|sub-42', log);
      expect(result.status).toBe('PENDING');
      expect(result.notes).toContain('xx-portal: credentials inactive');
    });

    it('GETs pollEndpoint/{id} and maps the portal status (CLEARED)', async () => {
      const http = makeHttp();
      const p = buildGenericPortalProvider(SPEC, HEURISTICS, makeCredentials(resolvedConfig), http);
      const result = await p.poll!('company1|sub-42', log);
      expect(result.status).toBe('CLEARED');
      expect(result.ref).toBe('company1|sub-42');
      expect(result.notes).toContain('xx-portal: APPROVED');
      expect((http.calls[0] as string[])[1]).toBe('https://test.example.gov/api/invoices/status/sub-42');
    });

    it('maps a reject-token status to REJECTED and unknown to PENDING', async () => {
      for (const [raw, mapped] of [
        ['INVALID_SIGNATURE', 'REJECTED'],
        ['IN_PROGRESS', 'PENDING'],
      ] as const) {
        const http = makeHttp({ get: async () => ({ status: 200, data: { status: raw } }) });
        const p = buildGenericPortalProvider(SPEC, HEURISTICS, makeCredentials(resolvedConfig), http);
        const result = await p.poll!('company1|sub-42', log);
        expect(result.status).toBe(mapped);
        expect(result.notes).toContain(`xx-portal: ${raw}`);
      }
    });

    it('poll HTTP failure degrades to PENDING with a poll-error note', async () => {
      const http = makeHttp({ get: async () => ({ status: 503, data: {} }) });
      const p = buildGenericPortalProvider(SPEC, HEURISTICS, makeCredentials(resolvedConfig), http);
      const result = await p.poll!('company1|sub-42', log);
      expect(result.status).toBe('PENDING');
      expect(result.notes).toContain('xx-portal: poll error: Test Portal: poll failed (HTTP 503)');
    });
  });

  describe('mapPortalStatus', () => {
    it('uses substring matching, clear tokens first', () => {
      expect(mapPortalStatus('fully CLEARED', HEURISTICS)).toBe('CLEARED');
      expect(mapPortalStatus('rejected by authority', HEURISTICS)).toBe('REJECTED');
      expect(mapPortalStatus('queued', HEURISTICS)).toBe('PENDING');
    });

    it('LATAM heuristics understand Spanish portal states (fallback EN_PROCESO → PENDING)', () => {
      expect(mapPortalStatus('AUTORIZADO', LATAM_PORTAL_HEURISTICS)).toBe('CLEARED');
      expect(mapPortalStatus('Aceptado', LATAM_PORTAL_HEURISTICS)).toBe('CLEARED');
      expect(mapPortalStatus('RECHAZADO', LATAM_PORTAL_HEURISTICS)).toBe('REJECTED');
      expect(mapPortalStatus(LATAM_PORTAL_HEURISTICS.statusFallback, LATAM_PORTAL_HEURISTICS)).toBe(
        'PENDING',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Per-region data guards
// ---------------------------------------------------------------------------

interface RegionCase {
  name: string;
  providers: typeof SMALL_LATAM_PROVIDERS;
  count: number;
  asyncIds: string[];
  realtimeIds: string[];
}

const REGIONS: RegionCase[] = [
  {
    name: 'LATAM',
    providers: SMALL_LATAM_PROVIDERS,
    count: 8,
    asyncIds: ['cr-hacienda', 'dgii', 'gt-sat', 'pa-dgi', 'sifen', 'sv-mh', 'seniat', 'bo-sin'],
    realtimeIds: [],
  },
  {
    name: 'Asia',
    providers: SMALL_ASIA_PROVIDERS,
    count: 9,
    asyncIds: ['tw-mof', 'kz-isesf', 'cn-sta', 'vn-gdt'],
    realtimeIds: ['ph-bir', 'th-rd', 'np-ird', 'bd-nbr', 'pk-fbr'],
  },
  {
    name: 'Africa',
    providers: SMALL_AFRICA_PROVIDERS,
    count: 8,
    asyncIds: ['gh-gra', 'rw-rra'],
    realtimeIds: ['tz-tra', 'ug-ura', 'zm-zra', 'zw-zimra', 'ci-dgi', 'bj-dgi'],
  },
  {
    name: 'MENA',
    providers: SMALL_MENA_PROVIDERS,
    count: 2,
    asyncIds: ['jofotara', 'tn-ttn'],
    realtimeIds: [],
  },
  {
    name: 'Europe',
    providers: EUROPE_PORTAL_PROVIDERS,
    count: 10,
    asyncIds: ['ua-dps', 'hr-fiskalizacija', 'al-cis', 'rs-sef'],
    realtimeIds: ['me-fiscal', 'lv-vid', 'sk-financnasprava', 'es-aeat', 'gr-aade', 'hu-nav'],
  },
];

/** Country-specific credential fields each portal's configSchema must expose. */
const REQUIRED_CONFIG_FIELDS: Record<string, string[]> = {
  // Africa
  'rw-rra': ['deviceSerial'],
  'tz-tra': ['gcn'],
  'zm-zra': ['deviceSerial'],
  'zw-zimra': ['bpno'],
  'ci-dgi': ['ncc'],
  'bj-dgi': ['ifu'],
  // MENA
  jofotara: ['tin', 'merchantId', 'apiToken'],
  'tn-ttn': ['matriculeFiscal', 'ttnSubscriberId', 'apiToken'],
  // Europe
  'ua-dps': ['ipn'],
  'me-fiscal': ['pib', 'tcrCode'],
  'hr-fiskalizacija': ['oib', 'businessPremise'],
  'al-cis': ['nipt'],
  'es-aeat': ['nif'],
  'gr-aade': ['afm', 'subscriptionKey'],
  'hu-nav': ['adoszam', 'login'],
  'rs-sef': ['pib'],
};

describe.each(REGIONS)('$name smaller portals (spec data)', ({ providers, count, asyncIds, realtimeIds }) => {
  const log = new RecordingComplianceLogger();

  it(`has ${count} providers with unique ids`, () => {
    expect(providers).toHaveLength(count);
    const ids = providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([...asyncIds, ...realtimeIds].sort());
  });

  it('all providers use GOV_PORTAL_API and declare a configSchema with an environment field', () => {
    for (const p of providers) {
      expect(p.channel).toBe('GOV_PORTAL_API');
      expect(p.configSchema?.fields.length).toBeGreaterThanOrEqual(2);
      expect(p.configSchema!.fields.map((f) => f.name)).toContain('environment');
    }
  });

  it('clearance (async) portals are ASYNC_POLL and expose poll()', () => {
    for (const id of asyncIds) {
      const p = providers.find((x) => x.id === id)!;
      expect(p).toBeDefined();
      expect(p.feedback).toBe('ASYNC_POLL');
      expect(p.pollPolicy).toBeDefined();
      expect(p.poll).toBeDefined();
    }
  });

  it('real-time/reporting portals are NONE feedback and have no poll()', () => {
    for (const id of realtimeIds) {
      const p = providers.find((x) => x.id === id)!;
      expect(p).toBeDefined();
      expect(p.feedback).toBe('NONE');
      expect(p.poll).toBeUndefined();
    }
  });

  it('all providers return SKIPPED when no resolved config', async () => {
    for (const p of providers) {
      const result = await p.transmit([], {} as never, {} as never, 'key', log, undefined);
      expect(result.status).toBe('SKIPPED');
      expect(result.notes.some((n) => n.includes(p.id))).toBe(true);
    }
  });

  it('async portals poll() returns PENDING when no credentials port (and on malformed ref)', async () => {
    for (const id of asyncIds) {
      const p = providers.find((x) => x.id === id)!;
      expect((await p.poll!('company1|submission-id', log)).status).toBe('PENDING');
      expect((await p.poll!('malformed-ref-without-pipe', log)).status).toBe('PENDING');
    }
  });

  it('country-specific credential fields are declared in configSchema', () => {
    for (const p of providers) {
      const required = REQUIRED_CONFIG_FIELDS[p.id];
      if (!required) continue;
      const fieldNames = p.configSchema!.fields.map((f) => f.name);
      for (const field of required) expect(fieldNames).toContain(field);
    }
  });
});

describe('smaller portals (cross-region)', () => {
  it('provider ids are globally unique across all five regions', () => {
    const ids = REGIONS.flatMap((r) => r.providers.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
